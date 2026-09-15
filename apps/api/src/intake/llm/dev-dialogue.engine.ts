import { Injectable } from '@nestjs/common';
import { ALLERGEN_TAGS, type AllergenTag } from '@raise/shared-types';
import type { DialogueEngine, DialogueTurnInput, DialogueTurnOutput } from './dialogue-engine.interface.js';
import type { ToolInvocationRecord } from '../tools/tool-types.js';

/**
 * Non-production dialogue engine: never calls Claude, never requires
 * ANTHROPIC_API_KEY. A small deterministic, keyword-driven state machine —
 * not real NLU, and not meant to be. Its job in dev/CI is narrower and more
 * important than sounding natural: it must call the exact same
 * `execute()` tool path (tool-definitions.ts -> tool-handlers.ts) the real
 * Claude engine would, so the grounding guarantee (docs/decisions.md Q2) is
 * proven against real code, not a mock — grounding is provider-independent
 * by design, and this class is the proof that it doesn't secretly depend
 * on Claude being the one calling the tools. Fixture transcripts in
 * intake.e2e-spec.ts are written to this engine's recognized phrasings on
 * purpose (see the regexes below), the same way DevOtpProvider's fixed code
 * is a deliberate test convention, not an attempt at realism.
 */
@Injectable()
export class DevDialogueEngine implements DialogueEngine {
  async runTurn(input: DialogueTurnInput): Promise<DialogueTurnOutput> {
    const text = input.customerMessage.trim();
    const toolInvocations: ToolInvocationRecord[] = [];
    const run = async (name: string, toolInput: unknown) => {
      const record = await input.execute(name, toolInput);
      toolInvocations.push(record);
      return record;
    };

    // 1) Party size + arrival time: "party of 4, arriving at 8:15pm"
    const partyMatch = /party of (\d+)/i.exec(text);
    const timeMatch = /arriving at (\d{1,2}):(\d{2})\s*(am|pm)/i.exec(text);
    if (partyMatch || timeMatch) {
      const setInput: { partySize?: number; arrivalEta?: string } = {};
      if (partyMatch) setInput.partySize = Number(partyMatch[1]);
      if (timeMatch) setInput.arrivalEta = toIsoToday(timeMatch);
      await run('set_party_details', setInput);
      const parts: string[] = [];
      if (setInput.partySize) parts.push(`a party of ${setInput.partySize}`);
      if (setInput.arrivalEta) parts.push(`arriving around ${timeMatch![0].replace(/^arriving at /i, '')}`);
      return { assistantMessage: `Got it — ${parts.join(', ')}. Anything from the menu I can help with?`, toolInvocations };
    }

    // 2) Menu question
    if (/what('?s| is) on the menu|what do you have|see the menu/i.test(text)) {
      const record = await run('list_available_menu_items', {});
      const items = (record.result as { items?: { name: string }[] }).items ?? [];
      const names = items.slice(0, 5).map((item) => item.name);
      return {
        assistantMessage: items.length
          ? `Tonight we have ${names.join(', ')}${items.length > names.length ? ', and more' : ''}. Want me to add anything?`
          : "It looks like we don't have anything available right now — sorry about that.",
        toolInvocations,
      };
    }

    // 3) Order: "I'll have the Butter Chicken and a Garlic Naan"
    const orderMatch = /(?:i'?ll have|i want|can i get|i'?d like) (.+)/i.exec(text);
    if (orderMatch) {
      const listRecord = await run('list_available_menu_items', {});
      const items = (listRecord.result as { items?: { id: string; name: string }[] }).items ?? [];
      const requested = orderMatch[1]
        .split(/,| and /i)
        .map((s) => s.trim().replace(/^(a|an|the)\s+/i, '').replace(/\.$/, ''))
        .filter(Boolean);

      const added: string[] = [];
      const missing: string[] = [];
      for (const phrase of requested) {
        const match = items.find((item) => item.name.toLowerCase().includes(phrase.toLowerCase()) || phrase.toLowerCase().includes(item.name.toLowerCase()));
        if (!match) {
          missing.push(phrase);
          continue;
        }
        const addRecord = await run('add_order_item', { menuItemId: match.id, quantity: 1 });
        const result = addRecord.result as { ok: boolean };
        if (result.ok) added.push(match.name);
        else missing.push(phrase);
      }

      const parts: string[] = [];
      if (added.length) parts.push(`Added ${added.join(' and ')} to your order.`);
      if (missing.length) parts.push(`I couldn't find "${missing.join('", "')}" on tonight's menu — want to pick something else?`);
      return { assistantMessage: parts.join(' ') || "I didn't catch a dish in that — could you tell me again?", toolInvocations };
    }

    // 4) Change of mind: "instead of the naan, give me the dal makhani"
    const swapMatch = /instead of (?:the |a |an )?(.+?),\s*(?:i'?ll have|give me|make it)\s*(?:the |a |an )?(.+)/i.exec(text);
    if (swapMatch) {
      const draft = await input.getDraftState();
      const oldName = swapMatch[1].trim();
      const newName = swapMatch[2].trim().replace(/\.$/, '');
      const existing = draft.items.find((item) => item.name.toLowerCase().includes(oldName.toLowerCase()));
      if (existing) await run('remove_order_item', { visitItemId: existing.id });

      const listRecord = await run('list_available_menu_items', {});
      const items = (listRecord.result as { items?: { id: string; name: string }[] }).items ?? [];
      const match = items.find((item) => item.name.toLowerCase().includes(newName.toLowerCase()));
      if (!match) {
        return { assistantMessage: `I couldn't find "${newName}" on tonight's menu — want to pick something else?`, toolInvocations };
      }
      const addRecord = await run('add_order_item', { menuItemId: match.id, quantity: 1 });
      const result = addRecord.result as { ok: boolean };
      return {
        assistantMessage: result.ok
          ? `Swapped that for ${match.name}.`
          : `Sorry, ${match.name} isn't available right now — want something else?`,
        toolInvocations,
      };
    }

    // 5) Remove: "actually, remove the naan" / "never mind the lassi"
    const removeMatch = /(?:remove|cancel|never mind)(?: the| that)? (.+)/i.exec(text);
    if (removeMatch) {
      const draft = await input.getDraftState();
      const name = removeMatch[1].trim().replace(/\.$/, '');
      const existing = draft.items.find((item) => item.name.toLowerCase().includes(name.toLowerCase()));
      if (!existing) {
        return { assistantMessage: `I don't see "${name}" in your order right now.`, toolInvocations };
      }
      await run('remove_order_item', { visitItemId: existing.id });
      return { assistantMessage: `Removed ${existing.name}.`, toolInvocations };
    }

    // 6) Quantity change on the most recently added item: "make that 2"
    const qtyMatch = /make (?:it|that) (\d+)/i.exec(text);
    if (qtyMatch) {
      const draft = await input.getDraftState();
      const last = draft.items[draft.items.length - 1];
      if (!last) return { assistantMessage: "You don't have anything in your order yet to change.", toolInvocations };
      await run('update_order_item', { visitItemId: last.id, quantity: Number(qtyMatch[1]) });
      return { assistantMessage: `Updated ${last.name} to ${qtyMatch[1]}.`, toolInvocations };
    }

    // 7) Allergy flag: "I'm allergic to peanuts"
    const allergyMatch = /allerg(?:y|ic)(?: to)? (\w+)/i.exec(text);
    if (allergyMatch) {
      const tag = matchAllergenTag(allergyMatch[1]);
      const draft = await input.getDraftState();
      if (!tag) {
        return { assistantMessage: `Noted — I'll flag that allergy for the kitchen.`, toolInvocations };
      }
      for (const item of draft.items) {
        if (item.allergyFlags.includes(tag)) continue;
        await run('update_order_item', { visitItemId: item.id, allergyFlags: [...item.allergyFlags, tag] });
      }
      return { assistantMessage: `Got it — I've flagged ${tag.replace('_', ' ')} on your order for the kitchen.`, toolInvocations };
    }

    // 8) Propose a specific table: "we'll take T4"
    const tableLabelMatch = /\bt\d+\b/i.exec(text);
    if (tableLabelMatch && /table|t\d+/i.test(text)) {
      const draft = await input.getDraftState();
      if (!draft.partySize) {
        return { assistantMessage: "How many will be in your party? I'll check what's free.", toolInvocations };
      }
      const listRecord = await run('list_open_tables', { partySize: draft.partySize });
      const tables = (listRecord.result as { tables?: { id: string; label: string }[] }).tables ?? [];
      const match = tables.find((table) => table.label.toLowerCase() === tableLabelMatch[0].toLowerCase());
      if (!match) {
        return { assistantMessage: `${tableLabelMatch[0].toUpperCase()} isn't free for your party size right now — want me to suggest another table?`, toolInvocations };
      }
      const proposeRecord = await run('propose_table', { tableId: match.id });
      const result = proposeRecord.result as { ok: boolean };
      return {
        assistantMessage: result.ok ? `Great — I've noted ${match.label} for you.` : `Sorry, ${match.label} just became unavailable — want another table?`,
        toolInvocations,
      };
    }

    // 9) General table availability question
    if (/table|seat us|sit us/i.test(text)) {
      const draft = await input.getDraftState();
      if (!draft.partySize) {
        return { assistantMessage: "How many will be in your party? I'll check what's free.", toolInvocations };
      }
      const listRecord = await run('list_open_tables', { partySize: draft.partySize });
      const tables = (listRecord.result as { tables?: { label: string }[] }).tables ?? [];
      return {
        assistantMessage: tables.length
          ? `We have ${tables.map((t) => t.label).join(', ')} open for a party of ${draft.partySize} — want one of those?`
          : `I'm sorry, we don't have a table open for a party of ${draft.partySize} right now.`,
        toolInvocations,
      };
    }

    // 10) Read-back / summary — constructed only from the structured draft, never from prose.
    if (/read (?:that|it) back|what do i have|summary|to confirm/i.test(text)) {
      const draft = await input.getDraftState();
      const itemsText = draft.items.length
        ? draft.items.map((item) => `${item.quantity}x ${item.name}`).join(', ')
        : 'nothing yet';
      const tableText = draft.tableProposal ? `, table ${draft.tableProposal.label}` : '';
      const partyText = draft.partySize ? `party of ${draft.partySize}` : 'party size not set yet';
      return {
        assistantMessage: `Here's what I have so far: ${partyText}${tableText}. Order: ${itemsText}. Let me know if anything needs to change.`,
        toolInvocations,
      };
    }

    // 11) Out of scope — no tool call, honest redirect.
    return {
      assistantMessage: "I'm just here to help set up your visit tonight — want to tell me about your party size, the menu, or a table?",
      toolInvocations,
    };
  }
}

function toIsoToday(timeMatch: RegExpExecArray): string {
  const [, hourStr, minuteStr, meridiem] = timeMatch;
  let hour = Number(hourStr) % 12;
  if (meridiem.toLowerCase() === 'pm') hour += 12;
  const date = new Date();
  date.setHours(hour, Number(minuteStr), 0, 0);
  return date.toISOString();
}

function matchAllergenTag(word: string): AllergenTag | null {
  const normalized = word.toLowerCase();
  const aliases: Record<string, AllergenTag> = {
    peanut: 'peanuts',
    peanuts: 'peanuts',
    nut: 'tree_nuts',
    nuts: 'tree_nuts',
    dairy: 'dairy',
    milk: 'dairy',
    gluten: 'gluten',
    wheat: 'gluten',
    shellfish: 'shellfish',
    shrimp: 'shellfish',
    egg: 'egg',
    eggs: 'egg',
    soy: 'soy',
    fish: 'fish',
    sesame: 'sesame',
  };
  const tag = aliases[normalized];
  return tag && ALLERGEN_TAGS.includes(tag) ? tag : null;
}
