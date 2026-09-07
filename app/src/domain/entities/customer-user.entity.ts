import { DomainValidationException } from '../exceptions/domain-validation.exception';

export interface CustomerUserProps {
  id: string;
  passwordHash: string;
  isActive: boolean;
  hasActiveCustomerLink: boolean;
}

export class CustomerUser {
  private constructor(
    public readonly id: string,
    public readonly passwordHash: string,
    public readonly isActive: boolean,
    public readonly hasActiveCustomerLink: boolean,
  ) {}

  static create(props: CustomerUserProps): CustomerUser {
    if (!props.id.trim()) {
      throw new DomainValidationException('Usuário sem identificador');
    }

    return new CustomerUser(
      props.id,
      props.passwordHash,
      props.isActive,
      props.hasActiveCustomerLink,
    );
  }
}
