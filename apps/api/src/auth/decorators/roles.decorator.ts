import { SetMetadata } from '@nestjs/common';
import type { StaffRole } from '../../generated/prisma/enums.js';

export const ROLES_KEY = 'roles';

/** Restricts an endpoint to staff whose membership role is one of `roles`. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);
