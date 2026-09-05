import type { Pool } from 'pg';

import { Cpf } from '@domain/value-objects/cpf.vo';
import { DatabaseOperationException } from '@infrastructure/exceptions/database-operation.exception';
import { InvocationTimings } from '@infrastructure/observability/invocation-timings';
import {
  FIND_IDENTITY_BY_CPF_QUERY,
  PgCustomerIdentityRepository,
} from '@infrastructure/persistence/pg/customer-identity.repository';

const ROW = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  password_hash: '$2b$12$hash',
  is_active: true,
  has_active_customer_link: true,
};

function arrange(result: unknown, timings = new InvocationTimings()) {
  const query = jest.fn();

  if (result instanceof Error) {
    query.mockRejectedValue(result);
  } else {
    query.mockResolvedValue(result);
  }

  const pool = { query } as unknown as Pool;

  return { query, repository: new PgCustomerIdentityRepository(pool, timings), timings };
}

describe('PgCustomerIdentityRepository', () => {
  const cpf = Cpf.create('123.456.789-09');

  it('should resolve identity, account state and link in a single round trip', async () => {
    const { repository, query } = arrange({ rows: [ROW] });

    const user = await repository.findByCpf(cpf.value);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(FIND_IDENTITY_BY_CPF_QUERY, ['12345678909']);
    expect(user).toMatchObject({ id: ROW.id, isActive: true, hasActiveCustomerLink: true });
  });

  it('should project only the fields the decision needs', () => {
    const projection = FIND_IDENTITY_BY_CPF_QUERY.slice(
      0,
      FIND_IDENTITY_BY_CPF_QUERY.indexOf('FROM users'),
    );

    expect(projection).toContain('u.id');
    expect(projection).toContain('u.password_hash');
    expect(projection).toContain('u.is_active');
    expect(projection).toContain('has_active_customer_link');
    expect(projection).not.toContain('name');
    expect(projection).not.toContain('email');
  });

  it('should resolve the link with EXISTS, without multiplying rows per link', () => {
    expect(FIND_IDENTITY_BY_CPF_QUERY).toContain('EXISTS');
    expect(FIND_IDENTITY_BY_CPF_QUERY).toContain('user_customers');
    expect(FIND_IDENTITY_BY_CPF_QUERY).toContain('c.is_active = TRUE');
    expect(FIND_IDENTITY_BY_CPF_QUERY).not.toMatch(/\bDISTINCT\b/);
  });

  it('should be a read: the query carries no writing statement', () => {
    expect(FIND_IDENTITY_BY_CPF_QUERY).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
  });

  it('should return null when no user carries the cpf', async () => {
    const { repository } = arrange({ rows: [] });

    await expect(repository.findByCpf(cpf.value)).resolves.toBeNull();
  });

  /**
   * A mensagem pública fica constante e o erro do driver vai como `cause`: é
   * assim que o log distingue estouro de tempo, DNS, autenticação e TLS sem que
   * nada disso alcance o cliente.
   */
  it('should translate a driver failure into the database exception, keeping the cause', async () => {
    const driverError = new Error('connection terminated unexpectedly');
    const { repository } = arrange(driverError);

    await expect(repository.findByCpf(cpf.value)).rejects.toThrow(DatabaseOperationException);
    await expect(repository.findByCpf(cpf.value)).rejects.toThrow(
      'Erro na operação busca de identidade externa por CPF',
    );
    await expect(repository.findByCpf(cpf.value)).rejects.toMatchObject({ cause: driverError });
  });

  it('should translate a non-error rejection as well', async () => {
    const { query, repository } = arrange({ rows: [] });
    query.mockRejectedValue('cabo desconectado');

    await expect(repository.findByCpf(cpf.value)).rejects.toThrow(
      'Erro na operação busca de identidade externa por CPF',
    );
  });

  it('should record the query duration for the invocation line', async () => {
    const timings = new InvocationTimings();
    const { repository } = arrange({ rows: [ROW] }, timings);

    await repository.findByCpf(cpf.value);

    expect(timings.snapshot().queryDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('should record the duration even when the query fails', async () => {
    const timings = new InvocationTimings();
    const { repository } = arrange(new Error('timeout'), timings);

    await repository.findByCpf(cpf.value).catch(() => undefined);

    expect(timings.snapshot().queryDurationMs).toBeGreaterThanOrEqual(0);
  });
});
