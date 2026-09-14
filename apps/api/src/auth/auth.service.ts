import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import { StaffTokenService } from './tokens/staff-token.service.js';
import { CustomerTokenService } from './tokens/customer-token.service.js';
import { OTP_PROVIDER, type OtpProvider } from './otp/otp-provider.interface.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
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
