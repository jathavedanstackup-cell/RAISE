import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from '../prisma/test-fixtures.js';

/**
 * CP5's own "done when" bar, made concrete:
 *  - a guest completes intake, sees an accurate read-back (GET
 *    /intake/:visitId, already proven in intake.e2e-spec.ts), explicitly
 *    confirms, and ends with a confirmed Visit + a genuinely held table.
 *  - nothing else in the codebase can reach `confirmed` — see the
 *    "TRUST BOUNDARY" describe block below.
 *  - double-confirm is safe (idempotent); concurrent confirms for the
 *    same table can't double-book — see the "CONCURRENCY" block.
 *  - every unhappy path named in the checkpoint has a defined behavior
 *    and a test.
 */
describe('CP5 confirmation & booking flow', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient;

  const restaurantId = `test-confirm-${randomUUID()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    rawPrisma = createTestPrismaClient();
    await rawPrisma.$connect();

    await rawPrisma.restaurant.create({
      data: {
        id: restaurantId,
        name: 'Test Confirm Kitchen',
        timezone: 'UTC',
        address: '1 Test St',
        phone: '+15555550199',
        settings: {},
      },
    });
  });

  afterAll(async () => {
    await deleteRestaurantCascade(rawPrisma, restaurantId);
    await rawPrisma.$disconnect();
    await app.close();
  });

  let labelCounter = 1000;
  /** A unique numeric suffix per call — table labels must be exactly "T<digits>" to match the dev dialogue engine's table-recognition regex (see dev-dialogue.engine.ts). */
  function nextLabelSuffix(): number {
    labelCounter += 1;
    return labelCounter;
  }

  /** A fresh dish + a fresh table, isolated per test so tests never interfere via shared rows. */
  async function seedDishAndTable() {
    const suffix = nextLabelSuffix();
    const dish = await rawPrisma.menuItem.create({
      data: {
        restaurantId,
        name: `Dish ${suffix}`,
        price: '12.00',
        prepTimeMinutes: 10,
        category: 'main',
        allergens: [],
        modifiableOptions: [],
        available: true,
      },
    });
    const table = await rawPrisma.table.create({
      data: { restaurantId, label: `T${suffix}`, seatsMin: 1, seatsMax: 6, features: [] },
    });
    return { dish, table };
  }

  /** Drives a guest through intake to "party+eta+item+table set, still draft" and returns everything needed to attempt a confirm. */
  async function buildReadyDraft(dishName: string, tableLabel: string) {
    const startRes = await request(app.getHttpServer()).post(`/restaurants/${restaurantId}/intake/start`).send();
    const visitId = startRes.body.visit.id as string;
    let draftToken = startRes.body.draftToken as string;

    const sendTurn = async (text: string) => {
      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/intake/${visitId}/turn`)
        .set('Authorization', `Bearer ${draftToken}`)
        .send({ mode: 'text', text });
      if (res.status === 201) draftToken = res.body.draftToken;
      return res;
    };

    await sendTurn('party of 2, arriving at 7:00pm');
    await sendTurn(`I'll have the ${dishName}`);
    await sendTurn(`We'll take ${tableLabel}`);

    return { visitId, draftToken };
  }

  /** Verifies a fresh phone via CP2's real, unchanged OTP endpoints (dev stub — no Twilio keys) and returns a customer token. */
  async function verifyCustomer(phone: string): Promise<string> {
    await request(app.getHttpServer()).post('/auth/customer/otp/request').send({ phone });
    const verifyRes = await request(app.getHttpServer())
      .post('/auth/customer/otp/verify')
      .send({ phone, code: process.env.OTP_DEV_FIXED_CODE });
    expect(verifyRes.status).toBe(201);
    return verifyRes.body.token as string;
  }

  it('happy path: intake -> read-back -> explicit confirm -> confirmed Visit + genuinely held table + audit trail', async () => {
    const { dish, table } = await seedDishAndTable();
    const { visitId, draftToken } = await buildReadyDraft(dish.name, table.label);
    const customerToken = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);

    // The read-back the guest must see before any confirm control appears.
    const stateRes = await request(app.getHttpServer())
      .get(`/restaurants/${restaurantId}/intake/${visitId}`)
      .set('Authorization', `Bearer ${draftToken}`);
    expect(stateRes.status).toBe(200);
    expect(stateRes.body.visit.partySize).toBe(2);
    expect(stateRes.body.visit.items).toHaveLength(1);
    expect(stateRes.body.visit.tableProposal.label).toBe(table.label);

    const confirmRes = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
      .set('Authorization', `Bearer ${draftToken}`)
      .set('X-Customer-Token', customerToken)
      .send();

    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.alreadyConfirmed).toBe(false);
    expect(confirmRes.body.visit.status).toBe('confirmed');
    expect(confirmRes.body.visit.table.id).toBe(table.id);
    expect(confirmRes.body.visit.items).toHaveLength(1);

    const dbVisit = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visitId } });
    expect(dbVisit.status).toBe('confirmed');
    expect(dbVisit.arrivalConfirmedAt).not.toBeNull();

    const dbTable = await rawPrisma.table.findUniqueOrThrow({ where: { id: table.id } });
    expect(dbTable.status).toBe('held'); // the real hold -- CP4 only ever proposed it

    const events = await rawPrisma.visitStatusEvent.findMany({ where: { visitId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'confirmed', actorType: 'customer', mechanism: 'explicit_confirm_endpoint' });
    expect(events[0].actorId).toBeTruthy();
  });

  it('idempotency: confirming twice (double-tap/retry/replay) produces one booking, not two', async () => {
    const { dish, table } = await seedDishAndTable();
    const { visitId, draftToken } = await buildReadyDraft(dish.name, table.label);
    const customerToken = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);

    const first = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
      .set('Authorization', `Bearer ${draftToken}`)
      .set('X-Customer-Token', customerToken)
      .send();
    expect(first.status).toBe(201);
    expect(first.body.alreadyConfirmed).toBe(false);

    const second = await request(app.getHttpServer())
      .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
      .set('Authorization', `Bearer ${draftToken}`)
      .set('X-Customer-Token', customerToken)
      .send();
    expect(second.status).toBe(201);
    expect(second.body.alreadyConfirmed).toBe(true);
    expect(second.body.visit.id).toBe(first.body.visit.id);

    const events = await rawPrisma.visitStatusEvent.findMany({ where: { visitId, status: 'confirmed' } });
    expect(events).toHaveLength(1); // not two

    const dbTable = await rawPrisma.table.findUniqueOrThrow({ where: { id: table.id } });
    expect(dbTable.status).toBe('held'); // not double-claimed
  });

  describe('CONCURRENCY: two guests racing for the same table', () => {
    it('exactly one confirm succeeds; the other gets an honest "that table just went" — proven with a real race', async () => {
      const { dish, table } = await seedDishAndTable();

      // Two independent draft visits, both proposing the SAME table.
      const guestA = await buildReadyDraft(dish.name, table.label);
      const guestB = await buildReadyDraft(dish.name, table.label);
      const tokenA = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);
      const tokenB = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/restaurants/${restaurantId}/visits/${guestA.visitId}/confirm`)
          .set('Authorization', `Bearer ${guestA.draftToken}`)
          .set('X-Customer-Token', tokenA)
          .send(),
        request(app.getHttpServer())
          .post(`/restaurants/${restaurantId}/visits/${guestB.visitId}/confirm`)
          .set('Authorization', `Bearer ${guestB.draftToken}`)
          .set('X-Customer-Token', tokenB)
          .send(),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const winner = resA.status === 201 ? resA : resB;
      const loser = resA.status === 409 ? resA : resB;
      expect(winner.body.visit.status).toBe('confirmed');
      expect(loser.body.reason).toBe('table_taken');
      expect(loser.body.message).toMatch(/table just went/i);

      // Exactly one visit confirmed, not two -- no double-booking.
      const confirmedVisits = await rawPrisma.visit.findMany({ where: { restaurantId, tableId: table.id, status: 'confirmed' } });
      expect(confirmedVisits).toHaveLength(1);

      const dbTable = await rawPrisma.table.findUniqueOrThrow({ where: { id: table.id } });
      expect(dbTable.status).toBe('held');

      // The loser's own visit is untouched -- still draft, not silently confirmed or corrupted.
      const loserVisitId = resA.status === 409 ? guestA.visitId : guestB.visitId;
      const loserVisit = await rawPrisma.visit.findUniqueOrThrow({ where: { id: loserVisitId } });
      expect(loserVisit.status).toBe('draft');
    });

    /**
     * A distinct race from the one above: two DIFFERENT verified customers
     * racing to claim the SAME unlinked draft (e.g. a shared or leaked
     * draft link -- Visit.customerId starts null under the guest-first
     * design). Surfaced by the broken-access-control review's own
     * question for this checkpoint: "who can confirm a booking that isn't
     * theirs?" Answer: whichever verified customer's request actually wins
     * the same atomic conditional UPDATE that already protects against
     * double-confirm -- the loser never gets silently bound to someone
     * else's identity or someone else's booking.
     */
    it('two different verified customers racing to claim the same unlinked draft: exactly one is bound, the other gets a conflict, never a wrongly-shared booking', async () => {
      const { dish, table } = await seedDishAndTable();
      const { visitId, draftToken } = await buildReadyDraft(dish.name, table.label);
      const tokenX = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);
      const tokenY = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);

      const [resX, resY] = await Promise.all([
        request(app.getHttpServer())
          .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
          .set('Authorization', `Bearer ${draftToken}`)
          .set('X-Customer-Token', tokenX)
          .send(),
        request(app.getHttpServer())
          .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
          .set('Authorization', `Bearer ${draftToken}`)
          .set('X-Customer-Token', tokenY)
          .send(),
      ]);

      const statuses = [resX.status, resY.status].sort();
      expect(statuses).toEqual([201, 409]); // never [201, 201] -- never both bound

      const dbVisit = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visitId } });
      expect(dbVisit.status).toBe('confirmed');
      expect(dbVisit.customerId).not.toBeNull(); // bound to exactly one of the two, not both/neither

      const events = await rawPrisma.visitStatusEvent.findMany({ where: { visitId, status: 'confirmed' } });
      expect(events).toHaveLength(1); // one audit row, one actor -- not two
    });
  });

  describe('UNHAPPY PATHS', () => {
    it('identity mismatch: a different verified customer can never confirm someone else\'s draft', async () => {
      const { dish, table } = await seedDishAndTable();
      const { visitId, draftToken } = await buildReadyDraft(dish.name, table.label);
      const ownerToken = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);
      const intruderToken = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);

      // First confirm attempt binds the visit to the owner's verified identity.
      const bound = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
        .set('Authorization', `Bearer ${draftToken}`)
        .set('X-Customer-Token', ownerToken)
        .send();
      expect(bound.status).toBe(201);

      // A second, different draft, confirmed already -- now an intruder with a DIFFERENT verified
      // identity (but who somehow obtained the draft token) tries the same visit again.
      const intruderAttempt = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
        .set('Authorization', `Bearer ${draftToken}`)
        .set('X-Customer-Token', intruderToken)
        .send();
      expect(intruderAttempt.status).toBe(404); // don't confirm the visit exists to a non-owner
    });

    it('missing party size / arrival time / table each block confirmation with a specific reason', async () => {
      const startRes = await request(app.getHttpServer()).post(`/restaurants/${restaurantId}/intake/start`).send();
      const visitId = startRes.body.visit.id as string;
      const draftToken = startRes.body.draftToken as string;
      const customerToken = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);

      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
        .set('Authorization', `Bearer ${draftToken}`)
        .set('X-Customer-Token', customerToken)
        .send();
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('missing_party_size');
    });

    it('item unavailable between read-back and confirm: re-grounds and refuses, does not confirm stale data', async () => {
      const { dish, table } = await seedDishAndTable();
      const { visitId, draftToken } = await buildReadyDraft(dish.name, table.label);
      const customerToken = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);

      // The dish goes unavailable after the read-back, before confirm.
      await rawPrisma.menuItem.update({ where: { id: dish.id }, data: { available: false } });

      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
        .set('Authorization', `Bearer ${draftToken}`)
        .set('X-Customer-Token', customerToken)
        .send();
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('items_unavailable');
      expect(res.body.unavailableItems).toHaveLength(1);

      const dbVisit = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visitId } });
      expect(dbVisit.status).toBe('draft'); // never confirmed as stale data
    });

    it('"wait, change one thing" at the confirm step: the guest can still edit before confirming, and the confirmed booking reflects the change', async () => {
      const { dish: dishA, table } = await seedDishAndTable();
      const dishB = await rawPrisma.menuItem.create({
        data: {
          restaurantId,
          name: `Alt Dish ${randomUUID().slice(0, 8)}`,
          price: '9.00',
          prepTimeMinutes: 8,
          category: 'main',
          allergens: [],
          modifiableOptions: [],
          available: true,
        },
      });
      const { visitId, draftToken: token1 } = await buildReadyDraft(dishA.name, table.label);

      // Guest changes their mind before confirming.
      const changeRes = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/intake/${visitId}/turn`)
        .set('Authorization', `Bearer ${token1}`)
        .send({ mode: 'text', text: `instead of the ${dishA.name.toLowerCase()}, give me the ${dishB.name.toLowerCase()}` });
      expect(changeRes.status).toBe(201);
      const draftToken = changeRes.body.draftToken as string;

      const customerToken = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);
      const confirmRes = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
        .set('Authorization', `Bearer ${draftToken}`)
        .set('X-Customer-Token', customerToken)
        .send();

      expect(confirmRes.status).toBe(201);
      expect(confirmRes.body.visit.items).toHaveLength(1);
      expect(confirmRes.body.visit.items[0].menuItemId).toBe(dishB.id); // the change stuck, not the original
    });

    it('no draft token: 404 -- IntakeDraftGuard\'s existing "don\'t confirm the visit exists" behavior, unchanged for this route', async () => {
      const { dish, table } = await seedDishAndTable();
      const { visitId } = await buildReadyDraft(dish.name, table.label);
      const customerToken = await verifyCustomer(`+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`);

      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
        .set('X-Customer-Token', customerToken)
        .send();
      expect(res.status).toBe(404);
    });

    it('no customer token (unverified): 401 -- the draft token alone is never sufficient', async () => {
      const { dish, table } = await seedDishAndTable();
      const { visitId, draftToken } = await buildReadyDraft(dish.name, table.label);

      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visitId}/confirm`)
        .set('Authorization', `Bearer ${draftToken}`)
        .send();
      expect(res.status).toBe(401);
    });

    it('OTP fails: an invalid code never produces a usable customer token, so confirm is unreachable', async () => {
      const phone = `+1555${randomUUID().replace(/\D/g, '').slice(0, 7)}`;
      await request(app.getHttpServer()).post('/auth/customer/otp/request').send({ phone });
      const badVerify = await request(app.getHttpServer()).post('/auth/customer/otp/verify').send({ phone, code: '000000' });
      expect(badVerify.status).toBe(401);
    });
  });

  /**
   * TRUST BOUNDARY invariant (Rule #4): nothing anywhere in this codebase
   * may write Visit.status = 'confirmed' except VisitsService.confirm.
   * Static, not behavioral, on purpose -- a future checkpoint could add a
   * *new* code path that writes 'confirmed' without ever exercising this
   * suite's other tests. This one fails the moment that happens, wherever
   * it happens.
   */
  it('TRUST BOUNDARY: no source file other than visits.service.ts writes Visit.status = "confirmed"', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const srcRoot = path.resolve(import.meta.dirname, '..');

    const offenders: string[] = [];
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === 'generated' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts') || entry.name.endsWith('.e2e-spec.ts')) continue;
        if (full === path.join(srcRoot, 'visits', 'visits.service.ts')) continue;
        const contents = await readFile(full, 'utf8');
        if (/status:\s*['"]confirmed['"]/.test(contents) || /VisitStatus\.confirmed/.test(contents)) {
          offenders.push(full);
        }
      }
    }
    await walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
