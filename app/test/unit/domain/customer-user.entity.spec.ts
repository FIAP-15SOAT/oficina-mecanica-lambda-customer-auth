import { CustomerUser } from '@domain/entities/customer-user.entity';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';

describe('CustomerUser', () => {
  const props = {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    passwordHash: '$2b$12$hash',
    isActive: true,
    hasActiveCustomerLink: true,
  };

  it('should expose the projection the authentication decision consumes', () => {
    const user = CustomerUser.create(props);

    expect(user).toMatchObject(props);
  });

  it.each(['', '   '])('should reject the identifier %p', (id) => {
    expect(() => CustomerUser.create({ ...props, id })).toThrow(DomainValidationException);
  });

  /**
   * Nome e e-mail não estão na entidade porque a consulta sequer os recupera:
   * não buscar é melhor que mascarar depois.
   */
  it('should not carry personal data', () => {
    expect(Object.keys(CustomerUser.create(props))).toEqual([
      'id',
      'passwordHash',
      'isActive',
      'hasActiveCustomerLink',
    ]);
  });
});
