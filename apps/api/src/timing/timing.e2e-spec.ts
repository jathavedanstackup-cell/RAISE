import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from '../prisma/test-fixtures.js';
import { PasswordService } from '../auth/password.service.js';
import { TimingService } from './timing.service.js';

/**
 * CP6's own "done when" bar, made concrete:
 *  - the engine's own arithmetic is proven with zero database in
 *    timing-engine.spec.ts; this file covers everything that needs a
 *    real confirmed Visit: recompute-on-drift (including the four named
 *    sub-cases), the accept-step trust boundary, and tenant isolation.
 *  - nothing else in the codebase can reach `kitchen_started` — see the
 *    "TRUST BOUNDARY" describe block.
 */
describe('CP6 timing engine', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient;
  let timing: TimingService;
  let passwords: PasswordService;

  const restaurantId = `test-timing-${randomUUID()}`;
  const restaurantBId = `test-timing-b-${randomUUID()}`;
  let kitchenToken: string;
  let ownerBToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    timing = app.get(TimingService);
    passwords = app.get(PasswordService);

    rawPrisma = createTestPrismaClient();
    await rawPrisma.$connect();

    // avgPrepBufferMinutes=5 / expoBufferMinutes=8 — same seeded pair timing-engine.spec.ts derives against, so a 12-minute dish reconciles the deck's worked example here too.
    for (const [id, name] of [
      [restaurantId, 'Test Timing Kitchen'],
      [restaurantBId, 'Test Timing Kitchen B'],
    ] as const) {
      await rawPrisma.restaurant.create({
        data: {
          id,
          name,
          timezone: 'UTC',
          address: '1 Test St',
          phone: '+15555550188',
          settings: { avgPrepBufferMinutes: 5, expoBufferMinutes: 8 },
        },
      });
    }

    const passwordHash = await passwords.hash('correct-horse-battery-staple');
    const kitchenUser = await rawPrisma.user.create({
      data: { email: `kitchen-${randomUUID()}@example.test`, passwordHash, name: 'Kitchen Staff' },
    });
    await rawPrisma.staffMembership.create({ data: { userId: kitchenUser.id, restaurantId, role: 'kitchen' } });
    const kitchenLogin = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: kitchenUser.email, password: 'correct-horse-battery-staple' });
    kitchenToken = kitchenLogin.body.token;

    const ownerBUser = await rawPrisma.user.create({
      data: { email: `owner-b-${randomUUID()}@example.test`, passwordHash, name: 'Owner B' },
    });
    await rawPrisma.staffMembership.create({ data: { userId: ownerBUser.id, restaurantId: restaurantBId, role: 'owner' } });
    const ownerBLogin = await request(app.getHttpServer())
      .post('/auth/staff/login')
      .send({ email: ownerBUser.email, password: 'correct-horse-battery-staple' });
    ownerBToken = ownerBLogin.body.token;
  });

  afterAll(async () => {
    await deleteRestaurantCascade(rawPrisma, restaurantId);
    await deleteRestaurantCascade(rawPrisma, restaurantBId);
    await rawPrisma.$disconnect();
    await app.close();
  });

  let labelCounter = 3000;
  function nextSuffix(): number {
    labelCounter += 1;
    return labelCounter;
  }

  /** A confirmed visit with one item and a held table — CP5's own trust boundary is proven elsewhere; this seeds the post-confirm state directly so CP6's tests exercise CP6's own logic, not CP4/CP5's flow again. */
  async function seedConfirmedVisit(opts: { prepTimeMinutes?: number; arrivalEta?: Date; restaurantId?: string } = {}) {
    const scopedRestaurantId = opts.restaurantId ?? restaurantId;
    const suffix = nextSuffix();
    const dish = await rawPrisma.menuItem.create({
      data: {
        restaurantId: scopedRestaurantId,
        name: `Dish ${suffix}`,
        price: '12.00',
        prepTimeMinutes: opts.prepTimeMinutes ?? 12,
        category: 'main',
        allergens: [],
        modifiableOptions: [],
        available: true,
      },
    });
    const table = await rawPrisma.table.create({
      data: { restaurantId: scopedRestaurantId, label: `T${suffix}`, seatsMin: 1, seatsMax: 4, features: [], status: 'held' },
    });
    // Customer.phone is globally unique and Customer rows aren't
    // restaurant-scoped, so they're never cleaned up by
    // deleteRestaurantCascade — a deterministic per-run suffix would
    // collide with a previous run's leftover rows. A random 9-digit
    // suffix keeps this unique across repeated invocations, not just
    // within one run (same style tenant-isolation.e2e-spec.ts uses).
    const randomPhoneSuffix = Math.floor(100_000_000 + Math.random() * 899_999_999);
    const customer = await rawPrisma.customer.create({
      data: { phone: `+1555${randomPhoneSuffix}`, phoneVerifiedAt: new Date() },
    });
    const arrivalEta = opts.arrivalEta ?? new Date(Date.UTC(2026, 5, 15, 20, 15));
    const visit = await rawPrisma.visit.create({
      data: {
        restaurantId: scopedRestaurantId,
        customerId: customer.id,
        partySize: 2,
        arrivalEta,
        arrivalConfirmedAt: new Date(),
        tableId: table.id,
        tableAssignedAt: new Date(),
        status: 'confirmed',
        visitItems: {
          create: [{ restaurantId: scopedRestaurantId, menuItemId: dish.id, quantity: 1, modifications: [], allergyFlags: [] }],
        },
      },
    });
    return { visit, dish, table, customer };
  }

  describe('recompute (initial computation, and after an order-item change)', () => {
    it('computes kitchen_start_target and food_out_target reproducing the deck example, from real DB rows', async () => {
      const { visit } = await seedConfirmedVisit({ prepTimeMinutes: 12, arrivalEta: new Date(Date.UTC(2026, 5, 15, 20, 15)) });

      const result = await timing.recompute(restaurantId, visit.id);

      expect(result.applied).toBe(true);
      expect(result.targets!.kitchenStartTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 19, 58)));
      expect(result.targets!.foodOutTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 20, 18)));

      const persisted = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(persisted.kitchenStartTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 19, 58)));
      expect(persisted.foodOutTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 20, 18)));
    });

    it('recomputes when an order item changed (a second, slower dish added) -- not just on ETA drift', async () => {
      const { visit, table } = await seedConfirmedVisit({ prepTimeMinutes: 12, arrivalEta: new Date(Date.UTC(2026, 5, 15, 20, 15)) });
      await timing.recompute(restaurantId, visit.id);

      // A slower second dish gets added to the same visit -- the ticket is now timed off it, not the original 12-minute one.
      const slowDish = await rawPrisma.menuItem.create({
        data: {
          restaurantId,
          name: `Slow dish ${nextSuffix()}`,
          price: '18.00',
          prepTimeMinutes: 20,
          category: 'main',
          allergens: [],
          modifiableOptions: [],
          available: true,
        },
      });
      await rawPrisma.visitItem.create({
        data: { restaurantId, visitId: visit.id, menuItemId: slowDish.id, quantity: 1, modifications: [], allergyFlags: [] },
      });
      void table;

      const result = await timing.recompute(restaurantId, visit.id);

      expect(result.applied).toBe(true);
      // 20min prep, 5min buffer -> 25min before arrival; 20+8min expo -> 28min from kitchen_start to food_out.
      expect(result.targets!.kitchenStartTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 19, 50)));
      expect(result.targets!.foodOutTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 20, 18)));
    });
  });

  describe('recompute-on-drift (arrival_eta changes after confirmation)', () => {
    it('accepts a drift that moves kitchen_start_target into the past -- an overdue ticket, not an error', async () => {
      const { visit } = await seedConfirmedVisit({ prepTimeMinutes: 12, arrivalEta: new Date(Date.UTC(2026, 5, 15, 20, 15)) });
      await timing.recompute(restaurantId, visit.id);
      const observed = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });

      // Guest says "actually we're outside now" -- arriving in 3 minutes, far sooner than the 12+5=17 minutes prep needs.
      const almostNow = new Date(Date.UTC(2026, 5, 15, 20, 3));
      const result = await timing.recomputeForEtaChange(restaurantId, visit.id, almostNow, observed.updatedAt);

      expect(result.applied).toBe(true);
      // kitchen_start_target = 20:03 - 17min = 19:46, which is BEFORE the original kitchen_start_target (19:58) -- the ticket should have already started.
      expect(result.targets!.kitchenStartTarget).toEqual(new Date(Date.UTC(2026, 5, 15, 19, 46)));
      expect(result.targets!.kitchenStartTarget.getTime()).toBeLessThan(new Date(Date.UTC(2026, 5, 15, 19, 58)).getTime());
    });

    it('"you cannot un-cook food": once the kitchen has accepted and started, a later ETA drift does not retarget the (already historical) times', async () => {
      const { visit } = await seedConfirmedVisit({ prepTimeMinutes: 12, arrivalEta: new Date(Date.UTC(2026, 5, 15, 20, 15)) });
      await timing.recompute(restaurantId, visit.id);
      const acceptRes = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visit.id}/kitchen/accept`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .send();
      expect(acceptRes.status).toBe(201);

      const beforeDrift = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(beforeDrift.status).toBe('kitchen_started');

      const result = await timing.recomputeForEtaChange(
        restaurantId,
        visit.id,
        new Date(Date.UTC(2026, 5, 15, 21, 0)),
        beforeDrift.updatedAt,
      );

      expect(result.applied).toBe(false);
      expect(result.rejection).toBe('visit_not_confirmed');
      const afterDrift = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      // Targets are exactly what they were when the kitchen actually started -- untouched.
      expect(afterDrift.kitchenStartTarget).toEqual(beforeDrift.kitchenStartTarget);
      expect(afterDrift.foodOutTarget).toEqual(beforeDrift.foodOutTarget);
      expect(afterDrift.arrivalEta).toEqual(beforeDrift.arrivalEta); // the drift's new ETA was never even written
    });

    it('several ETA updates in rapid succession: a stale update (based on an older read) does not overwrite a newer one', async () => {
      const { visit } = await seedConfirmedVisit({ prepTimeMinutes: 12, arrivalEta: new Date(Date.UTC(2026, 5, 15, 20, 15)) });
      const initial = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });

      // Both updates are built against the SAME observed row (simulating two requests that raced -- both read the visit before either one wrote).
      const firstEta = new Date(Date.UTC(2026, 5, 15, 20, 30));
      const secondEta = new Date(Date.UTC(2026, 5, 15, 20, 45));

      const firstResult = await timing.recomputeForEtaChange(restaurantId, visit.id, firstEta, initial.updatedAt);
      expect(firstResult.applied).toBe(true); // the first one to actually commit wins

      // The second request is now stale: it was built against `initial.updatedAt`, but the row already moved.
      const staleResult = await timing.recomputeForEtaChange(restaurantId, visit.id, secondEta, initial.updatedAt);
      expect(staleResult.applied).toBe(false);
      expect(staleResult.rejection).toBe('stale_update');

      const final = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      // The FIRST (winning) update's ETA stands -- the stale second one never overwrote it.
      expect(final.arrivalEta).toEqual(firstEta);
    });

    it('rejects a stale ETA update the same way even when the visit was never confirmed in the first place', async () => {
      const { visit } = await seedConfirmedVisit();
      const initial = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      await rawPrisma.visit.update({ where: { id: visit.id }, data: { status: 'cancelled' } });

      const result = await timing.recomputeForEtaChange(
        restaurantId,
        visit.id,
        new Date(Date.UTC(2026, 5, 15, 21, 0)),
        initial.updatedAt,
      );

      expect(result.applied).toBe(false);
      expect(result.rejection).toBe('visit_not_confirmed');
    });
  });

  describe('accept-step trust boundary', () => {
    it('POST kitchen/accept moves confirmed -> kitchen_started, with a full audit event', async () => {
      const { visit } = await seedConfirmedVisit();

      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visit.id}/kitchen/accept`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .send();

      expect(res.status).toBe(201);
      expect(res.body.alreadyAccepted).toBe(false);

      const persisted = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(persisted.status).toBe('kitchen_started');

      const events = await rawPrisma.visitStatusEvent.findMany({ where: { visitId: visit.id, status: 'kitchen_started' } });
      expect(events).toHaveLength(1);
      expect(events[0].actorType).toBe('staff');
      expect(events[0].mechanism).toBe('kitchen_accept_endpoint');
      expect(events[0].actorId).toBeTruthy();
    });

    it('double-accept is idempotent: same accepted state, not a second audit event', async () => {
      const { visit } = await seedConfirmedVisit();
      const first = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visit.id}/kitchen/accept`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .send();
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visit.id}/kitchen/accept`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .send();

      expect(second.status).toBe(201);
      expect(second.body.alreadyAccepted).toBe(true);

      const events = await rawPrisma.visitStatusEvent.findMany({ where: { visitId: visit.id, status: 'kitchen_started' } });
      expect(events).toHaveLength(1);
    });

    it('rejects accepting a visit that was never confirmed', async () => {
      const { visit } = await seedConfirmedVisit();
      await rawPrisma.visit.update({ where: { id: visit.id }, data: { status: 'cancelled' } });

      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visit.id}/kitchen/accept`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .send();

      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('not_confirmed');
    });

    /**
     * Static invariant (Rule #4), same pattern CP5's own TRUST BOUNDARY
     * test uses for `confirmed`: nothing anywhere in this codebase may
     * write `Visit.status = 'kitchen_started'` except
     * TimingService.acceptKitchenStart. Static, not behavioral, on
     * purpose -- a future checkpoint could add a *new* code path that
     * writes 'kitchen_started' without ever exercising this suite's other
     * tests. This one fails the moment that happens, wherever it happens.
     *
     * Proven red/green by hand during development: temporarily added
     * `status: 'kitchen_started'` to visits.service.ts and confirmed this
     * test failed, naming that exact file, before reverting it. See the
     * PR description for both runs.
     */
    it('TRUST BOUNDARY: no source file other than timing.service.ts writes Visit.status = "kitchen_started"', async () => {
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
          if (full === path.join(srcRoot, 'timing', 'timing.service.ts')) continue;
          const contents = await readFile(full, 'utf8');
          if (/status:\s*['"]kitchen_started['"]/.test(contents) || /VisitStatus\.kitchen_started/.test(contents)) {
            offenders.push(full);
          }
        }
      }
      await walk(srcRoot);
      expect(offenders).toEqual([]);
    });

    /**
     * Second static invariant, same family, guarding the *other* half of
     * "you cannot un-cook food". `recomputeTargets` reads the visit, checks
     * `status === 'confirmed'`, then writes the two target columns. These
     * transactions run at Read Committed, so an `acceptKitchenStart` that
     * commits between that read and that write would leave the unguarded
     * write free to retarget a visit whose kitchen had already started --
     * a check-then-write race, not a behavioural bug any single-threaded
     * test would ever catch. The fix is to re-assert the status in the
     * WHERE clause so check and write are one atomic step; this test pins
     * that the guard stays there.
     *
     * Proven red/green: removing `status: 'confirmed'` from that WHERE
     * clause makes this test fail; restoring it makes it pass.
     */
    it('TRUST BOUNDARY: the timing-target write is itself conditional on status = confirmed, not just the read before it', async () => {
      const { readFile } = await import('node:fs/promises');
      const path = await import('node:path');
      const source = await readFile(path.resolve(import.meta.dirname, 'timing.service.ts'), 'utf8');

      // Isolate the updateMany that writes the target columns, and assert its own WHERE clause carries the status guard.
      const targetWrite = /updateMany\(\{\s*where:\s*\{([^}]*)\},\s*data:\s*\{[^}]*kitchenStartTarget[^}]*\}/.exec(source);
      expect(targetWrite, 'could not locate the timing-target updateMany -- if it was refactored, update this invariant').not.toBeNull();
      expect(targetWrite![1]).toMatch(/status:\s*['"]confirmed['"]/);
    });
  });

  describe('tenant isolation', () => {
    it("restaurant B's staff cannot accept restaurant A's visit, and get a 404 (not a 403 that would confirm it exists)", async () => {
      const { visit } = await seedConfirmedVisit();

      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visit.id}/kitchen/accept`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send();

      expect(res.status).toBe(404);
      const persisted = await rawPrisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(persisted.status).toBe('confirmed'); // untouched
    });

    it("restaurant B's staff cannot trigger a recompute for restaurant A's visit either", async () => {
      const { visit } = await seedConfirmedVisit();

      const res = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/visits/${visit.id}/timing/recompute`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send();

      expect(res.status).toBe(404);
    });

    it("TimingService itself won't leak restaurant A's visit into a recompute scoped to restaurant B", async () => {
      const { visit } = await seedConfirmedVisit();

      // Same visitId, wrong restaurantId -- RLS/tenant scoping must reject this at the data layer, not just the guard layer.
      await expect(timing.recompute(restaurantBId, visit.id)).rejects.toThrow();
    });
  });
});
