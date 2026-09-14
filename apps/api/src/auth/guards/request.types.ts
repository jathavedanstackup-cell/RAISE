import type { Request } from 'express';
import type { StaffRole } from '../../generated/prisma/enums.js';

export interface StaffRequest extends Request {
  staffUserId: string;
  restaurantId: string;
  staffRole: StaffRole;
}

export interface CustomerRequest extends Request {
  customerId: string;
}
