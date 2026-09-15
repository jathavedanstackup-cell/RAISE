import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * NestJS's own documented pattern for schema-based validation (Pipes ->
 * "Object schema validation"), using Zod instead of class-validator per
 * docs/decisions.md — chosen specifically so the same schema validates
 * both the API request body (here) and the restaurant admin app's form
 * (apps/restaurant), rather than hand-rolling the rules twice.
 *
 * Apply this at the parameter level (`@Body(new ZodValidationPipe(schema))`),
 * not via method-level `@UsePipes()` — a method-level pipe runs against
 * every extracted parameter, including `@Param('id')`, and an object
 * schema will reject a plain string id outright.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
