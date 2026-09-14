import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { StaffJwtGuard } from './guards/staff-jwt.guard.js';
import type { StaffJwtRequest } from './guards/request.types.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('staff/login')
  staffLogin(@Body() body: { email?: string; password?: string }) {
    const { email, password } = requireStrings(body, ['email', 'password']);
    return this.auth.staffLogin(email, password);
  }

  @Get('staff/me')
  @UseGuards(StaffJwtGuard)
  staffMe(@Req() request: StaffJwtRequest) {
    return this.auth.staffMe(request.staffUserId);
  }

  @Post('customer/otp/request')
  async customerRequestOtp(@Body() body: { phone?: string }) {
    const { phone } = requireStrings(body, ['phone']);
    await this.auth.customerRequestOtp(phone);
    return { ok: true };
  }

  @Post('customer/otp/verify')
  customerVerifyOtp(@Body() body: { phone?: string; code?: string }) {
    const { phone, code } = requireStrings(body, ['phone', 'code']);
    return this.auth.customerVerifyOtp(phone, code);
  }
}

function requireStrings<K extends string>(
  body: Partial<Record<K, string>>,
  keys: K[],
): Record<K, string> {
  for (const key of keys) {
    if (typeof body[key] !== 'string' || body[key].length === 0) {
      throw new BadRequestException(`Missing or invalid "${key}"`);
    }
  }
  return body as Record<K, string>;
}
