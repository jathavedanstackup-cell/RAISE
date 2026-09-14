import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { StaffRole } from '../../generated/prisma/enums.js';
import type { StaffRequest } from './request.types.js';

/**
 * Must run after StaffRestaurantGuard (needs request.staffRole). Unlike the
 * tenant guard, an insufficient role is a genuine 403: the staff member
 * does have legitimate access to this restaurant, just not this action —
 * there's no tenant-existence fact to protect by hiding it as a 404.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<StaffRequest>();
    if (!required.includes(request.staffRole)) {
      throw new ForbiddenException(`Requires one of role(s): ${required.join(', ')}`);
    }
    return true;
  }
}
