/** Shape of GET /auth/staff/me — what the restaurant admin app uses right after login to discover which restaurant(s) the signed-in staff member may manage. */
export interface StaffMembershipDto {
  restaurantId: string;
  restaurantName: string;
  role: "owner" | "foh" | "kitchen";
}

export interface StaffMeDto {
  id: string;
  email: string;
  name: string;
  memberships: StaffMembershipDto[];
}
