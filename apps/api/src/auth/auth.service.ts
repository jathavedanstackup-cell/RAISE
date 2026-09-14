import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { StaffMeDto } from '@raise/shared-types';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { PasswordService } from './password.service.js';
import { StaffTokenService } from './tokens/staff-token.service.js';
import { CustomerTokenService } from './tokens/customer-token.service.js';
import { OTP_PROVIDER, type OtpProvider } from './otp/otp-provider.interface.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly passwords: PasswordService,
    private readonly staffTokens: StaffTokenService,
    private readonly customerTokens: CustomerTokenService,
    @Inject(OTP_PROVIDER) private readonly otp: OtpProvider,
  ) {}

  /**
   * `users` carries no restaurant_id (a staff account can hold memberships
   * at more than one restaurant) so this lookup is intentionally unscoped —
   * see docs/decisions.md. Which restaurant(s) this user may act on is
   * resolved per-request by StaffRestaurantGuard, not here.
   */
  async staffLogin(email: string, password: string): Promise<{ token: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same generic error whether the email doesn't exist or the password is
    // wrong — do not let login responses reveal which staff emails exist.
    if (!user || !(await this.passwords.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return { token: this.staffTokens.sign(user.id) };
  }

  /**
   * A staff JWT carries no restaurant_id (see the class-level note on
   * staffLogin), so the restaurant app calls this right after login to
   * discover which restaurant(s) the signed-in user may act on.
   *
   * Two scoped lookups, not one join, on purpose: `staff_memberships` is
   * read via forCurrentUser (CP3's self_membership_lookup RLS policy —
   * "show me my own membership rows"), then each distinct restaurant's
   * name is read via forRestaurant (CP2's existing tenant_isolation
   * policy). A single query joining straight to `restaurants` would have
   * to cross both policies in one transaction, effectively asking "and
   * also let me read a restaurants row despite app.current_restaurant_id
   * not being set" — exactly the kind of one-off carve-out CP2's pre-merge
   * fix removed. Two scoped calls, each answering exactly the question its
   * own policy already allows, is the smaller, easier-to-reason surface.
   */
  async staffMe(userId: string): Promise<StaffMeDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const memberships = await this.tenantPrisma.forCurrentUser(userId, (tx) =>
      tx.staffMembership.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    );

    const withRestaurantNames = await Promise.all(
      memberships.map(async (membership) => {
        const restaurant = await this.tenantPrisma.forRestaurant(membership.restaurantId, (tx) =>
          tx.restaurant.findUniqueOrThrow({ where: { id: membership.restaurantId } }),
        );
        return { restaurantId: membership.restaurantId, restaurantName: restaurant.name, role: membership.role };
      }),
    );

    return { id: user.id, email: user.email, name: user.name, memberships: withRestaurantNames };
  }

  async customerRequestOtp(phone: string): Promise<void> {
    await this.otp.sendCode(phone);
  }

  /**
   * Guest-first (Part 8 Q4): a verified phone is enough to get a session.
   * No name/email/full account required before a first booking — those
   * stay nullable on Customer and can be collected later.
   */
  async customerVerifyOtp(phone: string, code: string): Promise<{ token: string }> {
    const ok = await this.otp.verifyCode(phone, code);
    if (!ok) throw new UnauthorizedException('Invalid or expired code');

    const customer = await this.prisma.customer.upsert({
      where: { phone },
      update: { phoneVerifiedAt: new Date() },
      create: { phone, phoneVerifiedAt: new Date() },
    });
    return { token: this.customerTokens.sign(customer.id) };
  }
}
