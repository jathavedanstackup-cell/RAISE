import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { StaffTokenService } from './tokens/staff-token.service.js';
import { CustomerTokenService } from './tokens/customer-token.service.js';
import { StaffJwtGuard } from './guards/staff-jwt.guard.js';
import { CustomerJwtGuard } from './guards/customer-jwt.guard.js';
import { StaffRestaurantGuard } from './guards/staff-restaurant.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { OTP_PROVIDER } from './otp/otp-provider.interface.js';
import { DevOtpProvider } from './otp/dev-otp.provider.js';
import { TwilioOtpProvider } from './otp/twilio-otp.provider.js';

@Module({
  // Registered with no default secret: StaffTokenService and
  // CustomerTokenService each pass their own secret explicitly on every
  // sign/verify call (see docs/decisions.md — separate secrets per
  // audience, not a shared one).
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    StaffTokenService,
    CustomerTokenService,
    StaffJwtGuard,
    CustomerJwtGuard,
    StaffRestaurantGuard,
    RolesGuard,
    {
      provide: OTP_PROVIDER,
      // Defaults to the dev stub so a missing/misconfigured env var can
      // never accidentally start dialing Twilio; OTP_PROVIDER=twilio must
      // be set explicitly. See docs/decisions.md (Part 8 Q4).
      useClass: process.env.OTP_PROVIDER === 'twilio' ? TwilioOtpProvider : DevOtpProvider,
    },
  ],
  exports: [StaffJwtGuard, CustomerJwtGuard, StaffRestaurantGuard, RolesGuard, StaffTokenService, CustomerTokenService],
})
export class AuthModule {}
