import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('staff/login')
  staffLogin(@Body() body: { email?: string; password?: string }) {
    const { email, password } = requireStrings(body, ['email', 'password']);
    return this.auth.staffLogin(email, password);
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
