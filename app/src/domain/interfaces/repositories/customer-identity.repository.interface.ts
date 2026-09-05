import { CustomerUser } from '@domain/entities/customer-user.entity';

export interface ICustomerIdentityRepository {
  findByCpf(cpf: string): Promise<CustomerUser | null>;
}
