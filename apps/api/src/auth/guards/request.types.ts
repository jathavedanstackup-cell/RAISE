import type { Request } from 'express';
import type { StaffRole } from '../../generated/prisma/enums.js';

/** Set by StaffJwtGuard alone — the identity is verified, but no restaurant scope is known yet. */
export interface StaffJwtRequest extends Request {
  staffUserId: string;
}

/** Set once StaffRestaurantGuard has also run — restaurantId/staffRole are only safe to read after it. */
export interface StaffRequest extends StaffJwtRequest {
  restaurantId: string;
  staffRole: StaffRole;
}

export interface CustomerRequest extends Request {
  customerId: string;
}
