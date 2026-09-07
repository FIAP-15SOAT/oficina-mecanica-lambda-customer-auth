import { CustomerUser } from '@domain/entities/customer-user.entity';

export interface CustomerIdentityRow {
  id: string;
  password_hash: string;
  is_active: boolean;
  has_active_customer_link: boolean;
}

export function mapRowToCustomerUser(row: CustomerIdentityRow | undefined): CustomerUser | null {
  if (!row) {
    return null;
  }

  return CustomerUser.create({
    id: row.id,
    passwordHash: row.password_hash,
    isActive: row.is_active,
    hasActiveCustomerLink: row.has_active_customer_link,
  });
}
