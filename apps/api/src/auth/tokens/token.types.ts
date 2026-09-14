/** Decoded JWT payload shape common to both staff and customer tokens. */
export interface AuthTokenPayload {
  sub: string; // User.id (staff) or Customer.id (customer)
}
