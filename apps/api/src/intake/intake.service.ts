import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ConversationTurnDto, IntakeTurnRequest, IntakeTurnResponse, VisitDraftDto } from '@raise/shared-types';
import type { Prisma } from '../generated/prisma/client.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { IntakeTokenService } from '../auth/tokens/intake-token.service.js';
import { ASR_PROVIDER, type AsrProvider } from './asr/asr-provider.interface.js';
import { DIALOGUE_ENGINE, type DialogueEngine, type DialogueHistoryTurn } from './llm/dialogue-engine.interface.js';
import { executeTool } from './tools/tool-definitions.js';
import type { ToolExecutionContext } from './tools/tool-types.js';
import { toVisitDraftDto, type VisitWithItemsAndTable } from './draft-mapper.js';
import { DRAFT_INACTIVITY_WINDOW_MS } from './draft-policy.js';

const VISIT_ITEMS_INCLUDE = { visitItems: { include: { menuItem: true } }, table: true } as const;

type RawConversationTurn = { id: string; role: 'customer' | 'system'; transcript: string; createdAt: Date };

const GREETING = "Hi! Thanks for reaching out — how many will be joining you, and about when are you thinking of arriving?";
const OUT_OF_SCOPE_ASR_ERROR = "Having trouble hearing you right now — you can keep going by typing instead.";
const LLM_UNAVAILABLE_MESSAGE = "Sorry, having some trouble right now — could you try again in a moment?";

@Injectable()
export class IntakeService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly intakeTokens: IntakeTokenService,
    @Inject(ASR_PROVIDER) private readonly asr: AsrProvider,
    @Inject(DIALOGUE_ENGINE) private readonly dialogueEngine: DialogueEngine,
  ) {}

  /** Starts a new draft Visit and persists the opening greeting as a `system` ConversationTurn. Guest-first: `customerId` is attached only if OptionalCustomerJwtGuard resolved one. */
  async start(restaurantId: string, customerId: string | null): Promise<IntakeTurnResponse> {
    await this.getRestaurantOrThrow(restaurantId);

    const visit = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.visit.create({
        data: {
          restaurantId,
          customerId,
          specialNeeds: [],
          draftExpiresAt: new Date(Date.now() + DRAFT_INACTIVITY_WINDOW_MS),
        },
        include: VISIT_ITEMS_INCLUDE,
      }),
    );

    const turn = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.conversationTurn.create({
        data: { restaurantId, visitId: visit.id, role: 'system', transcript: GREETING },
      }),
    );

    return {
      visit: toVisitDraftDto(visit),
      turns: [toTurnDto(turn)],
      assistantMessage: GREETING,
      reengaged: false,
      draftToken: this.mintToken(visit),
    };
  }

  /**
   * Read-only reload/resume endpoint. Guarded by IntakeDraftGuard (see
   * docs/decisions.md, the CP4 pre-merge IDOR fix) — no token is minted
   * here since the caller must already be presenting a valid one to have
   * reached this method at all.
   */
  async getState(restaurantId: string, visitId: string): Promise<{ visit: VisitDraftDto; turns: ConversationTurnDto[] }> {
    const visit = await this.getVisitOrThrow(restaurantId, visitId);
    const turns = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.conversationTurn.findMany({ where: { restaurantId, visitId }, orderBy: { createdAt: 'asc' } }),
    );
    return { visit: toVisitDraftDto(visit), turns: turns.map(toTurnDto) };
  }

  async processTurn(restaurantId: string, visitId: string, request: IntakeTurnRequest): Promise<IntakeTurnResponse> {
    const visit = await this.getVisitOrThrow(restaurantId, visitId);

    // ASR/text resolution first — an ASR failure never reaches the dialogue
    // engine at all; the fallback IS the text/type path (docs/decisions.md Q1).
    // Nothing has been persisted yet at this point, so there is no
    // preceding turn to echo back on either of these early-exit paths.
    let customerText: string;
    if (request.mode === 'text') {
      customerText = request.text;
    } else {
      try {
        const transcription = await this.asr.transcribe({ base64: request.audioBase64, mimeType: request.mimeType });
        if (transcription.lowConfidence || !transcription.transcript.trim()) {
          return this.respondWithSystemTurn(restaurantId, visit, "Sorry, I didn't quite catch that — could you say that again, or type it instead?", false, []);
        }
        customerText = transcription.transcript;
      } catch {
        return this.respondWithSystemTurn(restaurantId, visit, OUT_OF_SCOPE_ASR_ERROR, false, []);
      }
    }

    // Persist the customer's turn regardless of what happens next — the
    // transcript is real even if the dialogue engine subsequently fails.
    // Captured by reference (not re-queried later) so the response always
    // reflects exactly the row this call created — see docs/decisions.md
    // (the CP4 pre-merge fix to the "last two turns" bug).
    const customerTurn = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.conversationTurn.create({ data: { restaurantId, visitId, role: 'customer', transcript: customerText } }),
    );

    // Silence/timeout: a draft that sat past its expiry window never
    // silently continues — recap and ask again. See docs/decisions.md Q3.
    const isExpired = visit.draftExpiresAt !== null && visit.draftExpiresAt.getTime() < Date.now();
    if (isExpired) {
      const draft = toVisitDraftDto(visit);
      const recap = buildRecapMessage(draft);
      return this.respondWithSystemTurn(restaurantId, visit, recap, true, [customerTurn]);
    }

    const history = await this.loadHistory(restaurantId, visitId);
    const toolCtx: ToolExecutionContext = { restaurantId, visitId, tenantPrisma: this.tenantPrisma };

    let assistantMessage: string;
    let toolInvocations: { name: string; input: unknown; result: unknown }[] = [];
    try {
      const outcome = await this.dialogueEngine.runTurn({
        restaurantId,
        visitId,
        history,
        customerMessage: customerText,
        execute: (name, input) => executeTool(name, input, toolCtx),
        getDraftState: async () => {
          const current = await this.getVisitOrThrow(restaurantId, visitId);
          return toVisitDraftDto(current);
        },
      });
      assistantMessage = outcome.assistantMessage;
      toolInvocations = outcome.toolInvocations;
    } catch {
      // LLM provider outage — the "provider outage" unhappy path. Never
      // fabricate a reply; say so honestly and keep the draft as-is.
      return this.respondWithSystemTurn(restaurantId, visit, LLM_UNAVAILABLE_MESSAGE, false, [customerTurn]);
    }

    const systemTurn = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.conversationTurn.create({
        data: {
          restaurantId,
          visitId,
          role: 'system',
          transcript: assistantMessage,
          structuredDelta: toolInvocations.length ? (toolInvocations as unknown as Prisma.InputJsonValue) : undefined,
        },
      }),
    );

    // Refresh the draft's inactivity window on every processed turn.
    await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.visit.updateMany({
        where: { id: visitId, restaurantId },
        data: { draftExpiresAt: new Date(Date.now() + DRAFT_INACTIVITY_WINDOW_MS) },
      }),
    );

    const updatedVisit = await this.getVisitOrThrow(restaurantId, visitId);
    return {
      visit: toVisitDraftDto(updatedVisit),
      turns: [customerTurn, systemTurn].map(toTurnDto),
      assistantMessage,
      reengaged: false,
      draftToken: this.mintToken(updatedVisit),
    };
  }

  /**
   * `precedingTurns` lets every early-exit path echo back whatever it
   * already persisted (typically the customer's own turn) alongside the
   * system reply this method creates — see docs/decisions.md: an earlier
   * version of this method silently dropped the customer's turn from the
   * response on every one of these paths.
   */
  private async respondWithSystemTurn(
    restaurantId: string,
    visit: VisitWithItemsAndTable,
    message: string,
    reengaged: boolean,
    precedingTurns: RawConversationTurn[],
  ): Promise<IntakeTurnResponse> {
    const turn = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.conversationTurn.create({ data: { restaurantId, visitId: visit.id, role: 'system', transcript: message } }),
    );
    if (reengaged) {
      await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
        tx.visit.updateMany({
          where: { id: visit.id, restaurantId },
          data: { draftExpiresAt: new Date(Date.now() + DRAFT_INACTIVITY_WINDOW_MS) },
        }),
      );
    }
    const current = await this.getVisitOrThrow(restaurantId, visit.id);
    return {
      visit: toVisitDraftDto(current),
      turns: [...precedingTurns, turn].map(toTurnDto),
      assistantMessage: message,
      reengaged,
      draftToken: this.mintToken(current),
    };
  }

  private mintToken(visit: { id: string; restaurantId: string }): string {
    return this.intakeTokens.sign(visit.id, visit.restaurantId);
  }

  private async loadHistory(restaurantId: string, visitId: string): Promise<DialogueHistoryTurn[]> {
    const turns = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.conversationTurn.findMany({ where: { restaurantId, visitId }, orderBy: { createdAt: 'asc' } }),
    );
    return turns.map((turn) => ({ role: turn.role, text: turn.transcript }));
  }

  private async getVisitOrThrow(restaurantId: string, visitId: string) {
    const visit = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.visit.findFirst({ where: { id: visitId, restaurantId }, include: VISIT_ITEMS_INCLUDE }),
    );
    if (!visit) throw new NotFoundException();
    return visit;
  }

  private async getRestaurantOrThrow(restaurantId: string) {
    const restaurant = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.restaurant.findFirst({ where: { id: restaurantId } }),
    );
    if (!restaurant) throw new NotFoundException();
    return restaurant;
  }
}

function toTurnDto(turn: RawConversationTurn): ConversationTurnDto {
  return { id: turn.id, role: turn.role, transcript: turn.transcript, createdAt: turn.createdAt.toISOString() };
}

function buildRecapMessage(draft: VisitDraftDto): string {
  const itemsText = draft.items.length ? draft.items.map((item) => `${item.quantity}x ${item.name}`).join(', ') : 'nothing yet';
  const partyText = draft.partySize ? `a party of ${draft.partySize}` : 'your party size not set yet';
  const tableText = draft.tableProposal ? `, table ${draft.tableProposal.label}` : '';
  return `That took a little while — here's what you had so far: ${partyText}${tableText}. Order: ${itemsText}. Still want to go ahead with this?`;
}
