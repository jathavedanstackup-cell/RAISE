import type { Request } from 'express';

export function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

/**
 * CP5: the confirm route needs two independent tokens on one request — the
 * draft capability token (proves "you hold this draft") and a customer
 * verification token (proves "you're a phone-verified customer"). Both
 * can't share the `Authorization` header, so the customer token travels
 * in its own header instead. See ConfirmCustomerGuard and
 * docs/decisions.md.
 */
export function extractHeaderToken(request: Request, headerName: string): string | undefined {
  const value = request.headers[headerName.toLowerCase()];
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}
