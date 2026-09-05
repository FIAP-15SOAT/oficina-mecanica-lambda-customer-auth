import { mapRowToCustomerUser } from '@infrastructure/persistence/pg/customer-identity.mapper';

const ROW = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  password_hash: '$2b$12$hash',
  is_active: true,
  has_active_customer_link: true,
};

describe('mapRowToCustomerUser', () => {
  it('should return null when the query found no row', () => {
    expect(mapRowToCustomerUser(undefined)).toBeNull();
  });

  it('should map a present row into the domain projection', () => {
    const user = mapRowToCustomerUser(ROW);

    expect(user).toMatchObject({
      id: ROW.id,
      passwordHash: ROW.password_hash,
      isActive: true,
      hasActiveCustomerLink: true,
    });
  });

  it('should carry the negative states through', () => {
    const user = mapRowToCustomerUser({
      ...ROW,
      is_active: false,
      has_active_customer_link: false,
    });

    expect(user?.isActive).toBe(false);
    expect(user?.hasActiveCustomerLink).toBe(false);
  });
});
