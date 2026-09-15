import type { TenantPrismaService } from '../../prisma/tenant-prisma.service.js';

/**
 * Bound once per turn by IntakeService and passed to every tool handler.
 * Every handler re-queries through `tenantPrisma` at call time — see
 * docs/decisions.md Q2: there is no per-turn cache here on purpose.
 */
export interface ToolExecutionContext {
  restaurantId: string;
  visitId: string;
  tenantPrisma: TenantPrismaService;
}

export interface ToolInvocationRecord {
  name: string;
  input: unknown;
  result: unknown;
}
