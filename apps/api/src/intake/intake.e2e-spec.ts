import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrismaClient, deleteRestaurantCascade } from '../prisma/test-fixtures.js';
import { PasswordService } from '../auth/password.service.js';
import { DIALOGUE_ENGINE } from './llm/dialogue-engine.interface.js';

/**
 * CP4's own "done when" bar, made concrete:
 *  - a scripted conversation (party size -> menu Q&A -> order -> allergy
 *    flag -> table proposal -> summary read-back) produces a correct
 *    structured draft every run, entirely against DevDialogueEngine +
 *    DevAsrProvider — no provider keys, deterministic (docs/decisions.md).
 *  - grounding is a hard boundary: a dish disabled mid-conversation can
 *    never be accepted (docs/decisions.md Q2) — the checkpoint's own
 *    required test.
 *  - every named unhappy path (ASR mishears, out-of-scope, no tables,
 *    item unavailable, mid-flow change of mind, silence/timeout, provider
 *    outage) has a defined behavior and an assertion here.
 *  - Visit.status never leaves `draft` anywhere in this file — CP5 owns
 *    `confirmed`.
 *  - CP4 pre-merge fix: draft access requires the draft-scoped
 *    `draftToken`, not just `visitId` — see "IDOR" tests below, and
 *    docs/decisions.md.
 */
function encodeFixtureTranscript(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('CP4 voice/chat intake pipeline', () => {
  let app: INestApplication;
  let rawPrisma: PrismaClient;
  let passwords: PasswordService;

  const restaurantId = `test-intake-${randomUUID()}`;
  const emptyRestaurantId = `test-intake-empty-${randomUUID()}`; // no tables at all
  let ownerToken: string;
  const ownerEmail = `owner-${randomUUID()}@example.test`;

  let dalMakhaniId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    rawPrisma = createTestPrismaClient();
    await rawPrisma.$connect();
    passwords = app.get(PasswordService);

    await rawPrisma.restaurant.create({
      data: {
        id: restaurantId,
        name: 'Test Intake Kitchen',
        timezone: 'UTC',
        address: '1 Test St',
        phone: '+15555550111',
        settings: {},
      },
    });
    await rawPrisma.restaurant.create({
      data: {
        id: emptyRestaurantId,
        name: 'Test Intake Kitchen (No Tables)',
        timezone: 'UTC',
        address: '2 Test St',
        phone: '+15555550112',
        settings: {},
      },
    });

    await rawPrisma.menuItem.create({
      data: {
        restaurantId,
        name: 'Butter Chicken',
        price: '18.00',
        prepTimeMinutes: 18,
        category: 'main',
        allergens: ['dairy'],
        modifiableOptions: [],
        available: true,
      },
    });

    await rawPrisma.menuItem.create({
      data: {
        restaurantId,
        name: 'Garlic Naan',
        price: '4.00',
        prepTimeMinutes: 6,
        category: 'bread',
        allergens: ['gluten'],
        modifiableOptions: [],
        available: true,
      },
    });

    const dalMakhani = await rawPrisma.menuItem.create({
      data: {
        restaurantId,
        name: 'Dal Makhani',
        price: '14.00',
        prepTimeMinutes: 12,
        category: 'main',
        allergens: ['dairy'],
        modifiableOptions: [],
        available: true,
      },
    });
    dalMakhaniId = dalMakhani.id;

    await rawPrisma.table.create({
      data: { restaurantId, label: 'T1', seatsMin: 1, seatsMax: 2, features: [] },
    });
    await rawPrisma.table.create({
      data: { restaurantId, label: 'T4', seatsMin: 4, seatsMax: 6, features: [] },
    });

    const passwordHash = await passwords.hash('correct-horse-battery-staple');
    const owner = await rawPrisma.user.create({ data: { email: ownerEmail, passwordHash, name: 'Owner' } });
    await rawPrisma.staffMembership.create({ data: { userId: owner.id, restaurantId, role: 'owner' } });
    const loginRes = await request(app.getHttpServer()).post('/auth/staff/login').send({ email: ownerEmail, password: 'correct-horse-battery-staple' });
    ownerToken = loginRes.body.token;
  });

  afterAll(async () => {
    await rawPrisma.staffMembership.deleteMany({ where: { restaurantId } });
    await rawPrisma.user.deleteMany({ where: { email: ownerEmail } });
    await deleteRestaurantCascade(rawPrisma, restaurantId);
    await deleteRestaurantCascade(rawPrisma, emptyRestaurantId);
    await rawPrisma.$disconnect();
    await app.close();
  });

  /**
   * A guest's session: tracks `visitId` and the current `draftToken`
   * together, since the token is reissued on every response (see
   * docs/decisions.md) and every subsequent call must send the latest
   * one, not the one minted at `start`.
   */
  function createSession(rid: string) {
    let visitId = '';
    let token = '';
    return {
      async start() {
        const res = await request(app.getHttpServer()).post(`/restaurants/${rid}/intake/start`).send();
        expect(res.status).toBe(201);
        expect(res.body.visit.status).toBe('draft');
        visitId = res.body.visit.id;
        token = res.body.draftToken;
        return res;
      },
      async sendText(text: string) {
        const res = await request(app.getHttpServer())
          .post(`/restaurants/${rid}/intake/${visitId}/turn`)
          .set('Authorization', `Bearer ${token}`)
          .send({ mode: 'text', text });
        if (res.status === 201 && res.body.draftToken) token = res.body.draftToken;
        return res;
      },
      async sendVoice(audioBase64: string, mimeType: string) {
        const res = await request(app.getHttpServer())
          .post(`/restaurants/${rid}/intake/${visitId}/turn`)
          .set('Authorization', `Bearer ${token}`)
          .send({ mode: 'voice', audioBase64, mimeType });
        if (res.status === 201 && res.body.draftToken) token = res.body.draftToken;
        return res;
      },
      async getState() {
        return request(app.getHttpServer()).get(`/restaurants/${rid}/intake/${visitId}`).set('Authorization', `Bearer ${token}`);
      },
      get visitId() {
        return visitId;
      },
      get token() {
        return token;
      },
    };
  }

  it('completes a full scripted conversation into a correct structured draft', async () => {
    const guest = createSession(restaurantId);
    await guest.start();

    const partyRes = await guest.sendText('party of 4, arriving at 8:00pm');
    expect(partyRes.status).toBe(201);
    expect(partyRes.body.visit.partySize).toBe(4);
    expect(partyRes.body.visit.arrivalEta).not.toBeNull();

    const menuRes = await guest.sendText("What's on the menu?");
    expect(menuRes.status).toBe(201);
    expect(menuRes.body.assistantMessage).toMatch(/Butter Chicken/i);

    const orderRes = await guest.sendText("I'll have the Butter Chicken and a Garlic Naan");
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.visit.items).toHaveLength(2);
    expect(orderRes.body.visit.items.map((i: { name: string }) => i.name).sort()).toEqual(['Butter Chicken', 'Garlic Naan']);

    const allergyRes = await guest.sendText("I'm allergic to peanuts");
    expect(allergyRes.status).toBe(201);
    expect(allergyRes.body.visit.items.every((i: { allergyFlags: string[] }) => i.allergyFlags.includes('peanuts'))).toBe(true);

    const tableRes = await guest.sendText('Do you have a table for us?');
    expect(tableRes.status).toBe(201);
    expect(tableRes.body.assistantMessage).toMatch(/T4/);

    const proposeRes = await guest.sendText("We'll take T4");
    expect(proposeRes.status).toBe(201);
    expect(proposeRes.body.visit.tableProposal).toMatchObject({ label: 'T4' });

    const summaryRes = await guest.sendText('Can you read that back to me?');
    expect(summaryRes.status).toBe(201);
    expect(summaryRes.body.assistantMessage).toMatch(/party of 4/i);
    expect(summaryRes.body.assistantMessage).toMatch(/T4/);
    expect(summaryRes.body.visit.status).toBe('draft');

    // Every turn was persisted under RLS via TenantPrismaService.
    const stateRes = await guest.getState();
    expect(stateRes.status).toBe(200);
    expect(stateRes.body.turns.length).toBeGreaterThanOrEqual(14); // greeting + 7 customer + 7 system turns
    expect(stateRes.body.turns.every((t: { role: string }) => t.role === 'customer' || t.role === 'system')).toBe(true);
  });

  it('GROUNDING: a dish disabled mid-conversation can no longer be accepted — the checkpoint-required test', async () => {
    const guest = createSession(restaurantId);
    await guest.start();
    await guest.sendText('party of 2, arriving at 7:00pm');

    const firstOrder = await guest.sendText("I'll have the Dal Makhani");
    expect(firstOrder.status).toBe(201);
    expect(firstOrder.body.visit.items).toHaveLength(1);
    expect(firstOrder.body.visit.items[0].menuItemId).toBe(dalMakhaniId);

    // Disable it mid-conversation, through CP3's real, already-proven endpoint.
    const disableRes = await request(app.getHttpServer())
      .patch(`/restaurants/${restaurantId}/menu-items/${dalMakhaniId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ available: false });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.available).toBe(false);

    // Same phrase, same conversation — the pipeline must not accept it again.
    const secondOrder = await guest.sendText("I'll have the Dal Makhani");
    expect(secondOrder.status).toBe(201);
    expect(secondOrder.body.assistantMessage).toMatch(/couldn't find|no longer available/i);
    // Still exactly one VisitItem — no phantom second row referencing the disabled dish.
    expect(secondOrder.body.visit.items).toHaveLength(1);

    const visitItemRows = await rawPrisma.visitItem.findMany({ where: { visitId: guest.visitId } });
    expect(visitItemRows).toHaveLength(1);
    expect(visitItemRows.every((row) => row.menuItemId === dalMakhaniId)).toBe(true);

    // Re-enable for any later test/run in this suite.
    await request(app.getHttpServer())
      .patch(`/restaurants/${restaurantId}/menu-items/${dalMakhaniId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ available: true });
  });

  it('UNHAPPY PATH: mid-flow change of mind — swap, remove, and quantity change all work', async () => {
    const guest = createSession(restaurantId);
    await guest.start();
    await guest.sendText('party of 2, arriving at 7:30pm');
    await guest.sendText("I'll have the Butter Chicken and a Garlic Naan");

    const removeRes = await guest.sendText('actually, remove the garlic naan');
    expect(removeRes.status).toBe(201);
    expect(removeRes.body.visit.items.map((i: { name: string }) => i.name)).toEqual(['Butter Chicken']);

    const swapRes = await guest.sendText('instead of the butter chicken, give me the dal makhani');
    expect(swapRes.status).toBe(201);
    expect(swapRes.body.visit.items.map((i: { name: string }) => i.name)).toEqual(['Dal Makhani']);

    const qtyRes = await guest.sendText('make that 2');
    expect(qtyRes.status).toBe(201);
    expect(qtyRes.body.visit.items).toHaveLength(1);
    expect(qtyRes.body.visit.items[0].quantity).toBe(2);
  });

  it('UNHAPPY PATH: out-of-scope request gets an honest redirect, no tool call, no draft mutation', async () => {
    const guest = createSession(restaurantId);
    await guest.start();
    const res = await guest.sendText("What's the weather like today?");
    expect(res.status).toBe(201);
    expect(res.body.visit.items).toHaveLength(0);
    expect(res.body.visit.partySize).toBeNull();
    expect(res.body.assistantMessage).not.toMatch(/rain|sunny|degrees/i);
  });

  it('UNHAPPY PATH: no table available for the party is stated honestly, never overpromised', async () => {
    const guest = createSession(emptyRestaurantId);
    await guest.start();
    await guest.sendText('party of 2, arriving at 7:00pm');
    const res = await guest.sendText('Do you have a table for us?');
    expect(res.status).toBe(201);
    expect(res.body.assistantMessage).toMatch(/don't have a table|no table/i);
    expect(res.body.visit.tableProposal).toBeNull();
  });

  it('UNHAPPY PATH: ASR mishears (low confidence) — asks the customer to repeat instead of guessing', async () => {
    const guest = createSession(restaurantId);
    await guest.start();
    const res = await guest.sendVoice(encodeFixtureTranscript('mumble mumble'), 'text/plain;low-confidence');
    expect(res.status).toBe(201);
    expect(res.body.assistantMessage).toMatch(/didn't quite catch|say that again/i);
    expect(res.body.visit.partySize).toBeNull();
  });

  it('voice mode (high confidence) is processed identically to text', async () => {
    const guest = createSession(restaurantId);
    await guest.start();
    const res = await guest.sendVoice(encodeFixtureTranscript('party of 3, arriving at 6:30pm'), 'audio/webm');
    expect(res.status).toBe(201);
    expect(res.body.visit.partySize).toBe(3);
  });

  it('UNHAPPY PATH: LLM provider outage — an honest message, draft untouched, never fabricated', async () => {
    const failingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DIALOGUE_ENGINE)
      .useValue({
        runTurn: () => {
          throw new Error('simulated provider outage');
        },
      })
      .compile();
    const failingApp = failingModule.createNestApplication();
    await failingApp.init();
    try {
      const startRes = await request(failingApp.getHttpServer()).post(`/restaurants/${restaurantId}/intake/start`).send();
      const visitId = startRes.body.visit.id as string;
      const token = startRes.body.draftToken as string;

      const res = await request(failingApp.getHttpServer())
        .post(`/restaurants/${restaurantId}/intake/${visitId}/turn`)
        .set('Authorization', `Bearer ${token}`)
        .send({ mode: 'text', text: 'party of 2, arriving at 7:00pm' });
      expect(res.status).toBe(201);
      expect(res.body.assistantMessage).toMatch(/trouble|try again/i);
      expect(res.body.visit.partySize).toBeNull(); // never fabricated from a failed turn
    } finally {
      await failingApp.close();
    }
  });

  it('UNHAPPY PATH: silence/timeout — a draft past its expiry window gets an honest recap, never a silent continuation', async () => {
    const guest = createSession(restaurantId);
    await guest.start();
    await guest.sendText('party of 2, arriving at 7:00pm');
    await guest.sendText("I'll have the Garlic Naan");

    // Fast-forward the draft's inactivity window into the past. (The
    // guest's held token is untouched — it was only just reissued and its
    // real cryptographic exp hasn't lapsed; only the DB column is faked
    // here, to isolate this test to the business-timeout behavior, not
    // token expiry. The next test below, "a business-stale draft is still
    // reachable...", is the one that exercises the token's own expiry
    // against real elapsed time — see docs/decisions.md's CP4 follow-up
    // entry for why the two need to be separate tests.)
    await rawPrisma.visit.update({ where: { id: guest.visitId }, data: { draftExpiresAt: new Date(Date.now() - 1000) } });

    const res = await guest.sendText('sorry, still there');
    expect(res.status).toBe(201);
    expect(res.body.reengaged).toBe(true);
    expect(res.body.assistantMessage).toMatch(/took a little while|still want to go ahead/i);
    expect(res.body.assistantMessage).toMatch(/Garlic Naan/i);
    expect(res.body.visit.status).toBe('draft');

    const refreshed = await rawPrisma.visit.findUniqueOrThrow({ where: { id: guest.visitId } });
    expect(refreshed.draftExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * CP4 follow-up (see docs/decisions.md): before this fix, the draft
   * token's own `exp` was tied to the same window as
   * `Visit.draftExpiresAt`, so IntakeDraftGuard rejected a returning
   * guest's token with a 404 at the exact moment IntakeService's own
   * recap-and-reconfirm logic was supposed to catch them — the Q3
   * behavior above was unreachable in production. Uses real elapsed time
   * against short, overridden windows (DRAFT_INACTIVITY_WINDOW_MS_OVERRIDE
   * / DRAFT_TOKEN_TTL_MS_OVERRIDE — test-only env levers, see
   * draft-policy.ts) rather than a faked DB column, so this genuinely
   * exercises JWT expiry, not just the business-staleness check.
   */
  it('CP4 follow-up: a business-stale draft is still reachable within the token\'s (longer) grace period — reaches recap, not a 404', async () => {
    process.env.DRAFT_INACTIVITY_WINDOW_MS_OVERRIDE = '50';
    process.env.DRAFT_TOKEN_TTL_MS_OVERRIDE = '3000';
    try {
      const guest = createSession(restaurantId);
      await guest.start();
      await guest.sendText("I'll have the Garlic Naan");

      // Let the (overridden, 50ms) business window genuinely lapse in
      // real time. The (overridden, 3000ms) token is nowhere near expiry.
      await new Promise((resolve) => setTimeout(resolve, 200));

      const res = await guest.sendText('sorry, still there');
      expect(res.status).toBe(201);
      expect(res.body.reengaged).toBe(true);
      expect(res.body.assistantMessage).toMatch(/took a little while|still want to go ahead/i);
      expect(res.body.assistantMessage).toMatch(/Garlic Naan/i);
    } finally {
      delete process.env.DRAFT_INACTIVITY_WINDOW_MS_OVERRIDE;
      delete process.env.DRAFT_TOKEN_TTL_MS_OVERRIDE;
    }
  });

  it('a visit from another restaurant 404s rather than leaking cross-tenant', async () => {
    const guest = createSession(restaurantId);
    await guest.start();
    // A structurally valid, correctly-signed token — just minted for the
    // wrong restaurant relative to the URL it's presented against.
    const res = await request(app.getHttpServer())
      .post(`/restaurants/${emptyRestaurantId}/intake/${guest.visitId}/turn`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ mode: 'text', text: 'party of 2, arriving at 7:00pm' });
    expect(res.status).toBe(404);
  });

  /**
   * IDOR regression coverage (CP4 pre-merge fix — see docs/decisions.md).
   * Every existing isolation test in this repo (menu-items.e2e-spec.ts,
   * tenant-isolation.e2e-spec.ts) covers restaurant A vs restaurant B.
   * None of them cover guest A vs guest B *inside the same restaurant* —
   * exactly the gap `visitId`-only authorization left open, since two
   * guests at the same restaurant share a `restaurantId` and the old code
   * checked nothing else.
   */
  describe('IDOR: guest A cannot read or mutate guest B\'s draft at the same restaurant', () => {
    it('guest B\'s token cannot GET or POST to guest A\'s visit, and guest A\'s draft is untouched afterward', async () => {
      const guestA = createSession(restaurantId);
      await guestA.start();
      const addRes = await guestA.sendText("I'll have the Garlic Naan");
      expect(addRes.status).toBe(201);
      expect(addRes.body.visit.items).toHaveLength(1);

      const stateBefore = await guestA.getState();
      const turnCountBefore = stateBefore.body.turns.length;

      const guestB = createSession(restaurantId);
      await guestB.start();

      // Guest B's own, validly-signed token — for guest B's own visit, not A's.
      const readAttempt = await request(app.getHttpServer())
        .get(`/restaurants/${restaurantId}/intake/${guestA.visitId}`)
        .set('Authorization', `Bearer ${guestB.token}`);
      expect(readAttempt.status).toBe(404);

      const mutateAttempt = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/intake/${guestA.visitId}/turn`)
        .set('Authorization', `Bearer ${guestB.token}`)
        .send({ mode: 'text', text: 'actually, remove the garlic naan' });
      expect(mutateAttempt.status).toBe(404);

      // Guest A's draft is byte-identical to before guest B's attempts.
      const stateAfter = await guestA.getState();
      expect(stateAfter.status).toBe(200);
      expect(stateAfter.body.visit.items).toEqual(stateBefore.body.visit.items);
      expect(stateAfter.body.turns.length).toBe(turnCountBefore);
    });

    it('a request with no token 404s on both routes', async () => {
      const guest = createSession(restaurantId);
      await guest.start();

      const getRes = await request(app.getHttpServer()).get(`/restaurants/${restaurantId}/intake/${guest.visitId}`);
      expect(getRes.status).toBe(404);

      const postRes = await request(app.getHttpServer())
        .post(`/restaurants/${restaurantId}/intake/${guest.visitId}/turn`)
        .send({ mode: 'text', text: 'hello' });
      expect(postRes.status).toBe(404);
    });
  });

  it('Visit.status is never anything but draft anywhere in this suite', async () => {
    const allTouched = await rawPrisma.visit.findMany({ where: { restaurantId: { in: [restaurantId, emptyRestaurantId] } } });
    expect(allTouched.every((visit) => visit.status === 'draft')).toBe(true);
  });
});
