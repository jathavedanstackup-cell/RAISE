import { Injectable } from '@nestjs/common';
import type { DashboardTableSummaryDto, DashboardVisitDto, DashboardVisitStatus } from '@raise/shared-types';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

const INBOUND_STATUSES: DashboardVisitStatus[] = ['confirmed', 'kitchen_started', 'table_set', 'guest_arrived', 'food_out'];

const VISIT_INCLUDE = { table: true, visitItems: { include: { menuItem: true } } } as const;

@Injectable()
export class DashboardService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** "Tonight — Inbound": every visit still active tonight, soonest arrival first. Initial HTTP load; VisitsGateway carries live updates after that. */
  async listInboundVisits(restaurantId: string): Promise<DashboardVisitDto[]> {
    const visits = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.visit.findMany({
        where: { restaurantId, status: { in: INBOUND_STATUSES }, tableId: { not: null } },
        include: VISIT_INCLUDE,
        orderBy: { arrivalEta: 'asc' },
      }),
    );

    return visits.map((visit) => ({
      id: visit.id,
      status: visit.status as DashboardVisitStatus,
      partySize: visit.partySize!,
      arrivalEta: visit.arrivalEta!.toISOString(),
      table: { id: visit.table!.id, label: visit.table!.label },
      items: visit.visitItems.map((item) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        name: item.menuItem.name,
        price: item.menuItem.price.toString(),
        quantity: item.quantity,
        modifications: item.modifications,
        allergyFlags: item.allergyFlags as DashboardVisitDto['items'][number]['allergyFlags'],
      })),
      kitchenStartTarget: visit.kitchenStartTarget?.toISOString() ?? null,
      foodOutTarget: visit.foodOutTarget?.toISOString() ?? null,
    }));
  }

  async listTables(restaurantId: string): Promise<DashboardTableSummaryDto[]> {
    const tables = await this.tenantPrisma.forRestaurant(restaurantId, (tx) =>
      tx.table.findMany({ where: { restaurantId }, orderBy: { label: 'asc' } }),
    );
    return tables.map((table) => ({
      id: table.id,
      label: table.label,
      seatsMin: table.seatsMin,
      seatsMax: table.seatsMax,
      status: table.status,
    }));
  }
}
