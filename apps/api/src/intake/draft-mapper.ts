import type { VisitDraftDto, VisitItemDto, AllergenTag } from '@raise/shared-types';
import type { Prisma } from '../generated/prisma/client.js';

export type VisitWithItemsAndTable = Prisma.VisitGetPayload<{
  include: { visitItems: { include: { menuItem: true } }; table: true };
}>;

/** The single place a Prisma Visit becomes the shape the client sees — always built from live rows, never from the assistant's own words. */
export function toVisitDraftDto(visit: VisitWithItemsAndTable): VisitDraftDto {
  const items: VisitItemDto[] = visit.visitItems.map((visitItem) => ({
    id: visitItem.id,
    menuItemId: visitItem.menuItemId,
    name: visitItem.menuItem.name,
    price: visitItem.menuItem.price.toString(),
    quantity: visitItem.quantity,
    modifications: visitItem.modifications,
    allergyFlags: visitItem.allergyFlags as AllergenTag[],
  }));

  return {
    id: visit.id,
    restaurantId: visit.restaurantId,
    status: 'draft',
    partySize: visit.partySize ?? null,
    hasChild: visit.hasChild,
    specialNeeds: visit.specialNeeds,
    arrivalEta: visit.arrivalEta ? visit.arrivalEta.toISOString() : null,
    tableProposal: visit.table
      ? { tableId: visit.table.id, label: visit.table.label, seatsMin: visit.table.seatsMin, seatsMax: visit.table.seatsMax }
      : null,
    items,
    draftExpiresAt: visit.draftExpiresAt ? visit.draftExpiresAt.toISOString() : null,
  };
}
