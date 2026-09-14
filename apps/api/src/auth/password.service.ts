import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Argon2id via the `argon2` package — OWASP's current recommended default
 * for password storage, and not something to hand-roll (per CLAUDE.md
 * Rule #1 / this checkpoint's instructions). See docs/decisions.md.
 */
@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, { type: argon2.argon2id });
  }

  verify(hash: string, plaintext: string): Promise<boolean> {
    return argon2.verify(hash, plaintext);
  }
}
