import { Pool } from 'pg';

import { CustomerUser } from '@domain/entities/customer-user.entity';
import { ICustomerIdentityRepository } from '@domain/interfaces/repositories/customer-identity.repository.interface';

import { DatabaseOperationException } from '@infrastructure/exceptions/database-operation.exception';
import { InvocationTimings } from '@infrastructure/observability/invocation-timings';

import { CustomerIdentityRow, mapRowToCustomerUser } from './customer-identity.mapper';

export const FIND_IDENTITY_BY_CPF_QUERY = `
  SELECT
    u.id,
    u.password_hash,
    u.is_active,
    EXISTS (
      SELECT 1
      FROM user_customers uc
      JOIN customers c ON c.id = uc.customer_id
      WHERE uc.user_id = u.id
        AND c.is_active = TRUE
    ) AS has_active_customer_link
  FROM users u
  WHERE u.cpf = $1
`;

export class PgCustomerIdentityRepository implements ICustomerIdentityRepository {
  constructor(
    private readonly pool: Pool,
    private readonly timings: InvocationTimings,
  ) {}

  async findByCpf(cpf: string): Promise<CustomerUser | null> {
    try {
      const result = await this.timings.measure('queryDurationMs', () =>
        this.pool.query<CustomerIdentityRow>(FIND_IDENTITY_BY_CPF_QUERY, [cpf]),
      );

      return mapRowToCustomerUser(result.rows[0]);
    } catch (error) {
      throw new DatabaseOperationException('busca de identidade externa por CPF', { cause: error });
    }
  }
}
