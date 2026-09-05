import { generateKeyPairSync } from 'node:crypto';
import { Writable } from 'node:stream';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { Pool } from 'pg';

import { DECLARED_FIELD_NAMES } from '@infrastructure/logging/field-registry';

import { closeDependencies, resetDependencies } from '../../src/bootstrap';
import { handler } from '../../src/handler';
import { buildContext, buildJsonEvent } from '../helpers/platform-event.factory';
import { MigratedDatabase, startMigratedDatabase } from './database.harness';
import { clearIdentity, seedIdentity } from './identity.fixture';

const mockLogLines: string[] = [];

jest.mock('@infrastructure/logging/logging-destination', () => ({
  createDefaultDestination: () =>
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        mockLogLines.push(chunk.toString('utf8'));
        callback();
      },
    }),
}));

const PASSWORD = 'Senha@123';
const PASSWORD_HASH = '$2b$12$p6XVg4lX9xZMx5lcA6Id3eXPSczStxFpu6y8gm9fz5W.shfjpI9tK';

const CPF_GRANTED = '12345678909';
const CPF_INACTIVE_USER = '52998224725';
const CPF_NO_LINK = '11144477735';
const CPF_ONLY_INACTIVE_CUSTOMERS = '01234567890';
const CPF_ABSENT = '98765432100';

const ISSUER = 'oficina-customer-auth';
const AUDIENCE = 'oficina-api';
const KEY_ID = 'customer-auth-test';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

async function login(body: Record<string, unknown>) {
  const response = await handler(buildJsonEvent(body), buildContext());

  return {
    statusCode: response.statusCode,
    body: JSON.parse(String(response.body)) as Record<string, unknown>,
  };
}

describe('external authentication against the real API schema', () => {
  let database: MigratedDatabase;
  let pool: Pool;
  const originalEnv = process.env;

  beforeAll(async () => {
    database = await startMigratedDatabase();

    pool = new Pool({
      host: database.host,
      port: database.port,
      database: database.database,
      user: database.username,
      password: database.password,
      max: 1,
    });

    await clearIdentity(pool);
    await seedIdentity(pool, {
      cpf: CPF_GRANTED,
      passwordHash: PASSWORD_HASH,
      customers: [{ active: false }, { active: true }],
    });
    await seedIdentity(pool, {
      cpf: CPF_INACTIVE_USER,
      passwordHash: PASSWORD_HASH,
      userActive: false,
      customers: [{ active: true }],
    });
    await seedIdentity(pool, { cpf: CPF_NO_LINK, passwordHash: PASSWORD_HASH, customers: [] });
    await seedIdentity(pool, {
      cpf: CPF_ONLY_INACTIVE_CUSTOMERS,
      passwordHash: PASSWORD_HASH,
      customers: [{ active: false }],
    });

    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DATABASE_HOST: database.host,
      DATABASE_PORT: String(database.port),
      DATABASE_NAME: database.database,
      DATABASE_SSL: 'false',
      DATABASE_SECRET: JSON.stringify({
        username: database.username,
        password: database.password,
      }),
      CUSTOMER_JWT_PRIVATE_KEY: privateKey,
      CUSTOMER_JWT_ISSUER: ISSUER,
      CUSTOMER_JWT_AUDIENCE: AUDIENCE,
      CUSTOMER_JWT_KEY_ID: KEY_ID,
    };

    resetDependencies();
  }, 300_000);

  afterAll(async () => {
    await closeDependencies();
    resetDependencies();
    process.env = originalEnv;

    await pool?.end();
    await database?.stop();
  });

  describe('valid credential', () => {
    it('should issue a token for a user linked to an active customer', async () => {
      const { statusCode, body } = await login({ cpf: CPF_GRANTED, password: PASSWORD });

      expect(statusCode).toBe(200);
      expect(body.data).toMatchObject({ expiresIn: 3600 });
    });

    it('should issue a token the API verification accepts, with exactly the agreed claims', async () => {
      const { body } = await login({ cpf: CPF_GRANTED, password: PASSWORD });
      const { accessToken } = body.data as { accessToken: string };

      const verified = await jwtVerify(accessToken, await importSPKI(publicKey, 'RS256'), {
        algorithms: ['RS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });

      expect(Object.keys(verified.payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub']);
      expect(decodeProtectedHeader(accessToken).kid).toBe(KEY_ID);
      expect(JSON.stringify(verified.payload)).not.toContain(CPF_GRANTED);
    });

    it('should accept the cpf written with punctuation', async () => {
      expect((await login({ cpf: '123.456.789-09', password: PASSWORD })).statusCode).toBe(200);
    });
  });

  describe('credential rejection', () => {
    it('should answer identically for the four rejection causes', async () => {
      const responses = await Promise.all([
        login({ cpf: CPF_ABSENT, password: PASSWORD }),
        login({ cpf: CPF_GRANTED, password: 'senha-errada' }),
        login({ cpf: CPF_INACTIVE_USER, password: PASSWORD }),
        login({ cpf: CPF_NO_LINK, password: PASSWORD }),
      ]);

      responses.forEach((response) => expect(response.statusCode).toBe(401));
      expect(new Set(responses.map((response) => JSON.stringify(response))).size).toBe(1);
    });

    it('should reject a user whose linked customers are all inactive', async () => {
      expect(
        (await login({ cpf: CPF_ONLY_INACTIVE_CUSTOMERS, password: PASSWORD })).statusCode,
      ).toBe(401);
    });
  });

  describe('invalid input', () => {
    it('should refuse an invalid cpf before reaching the database', async () => {
      const { statusCode, body } = await login({ cpf: '111.111.111-11', password: PASSWORD });

      expect(statusCode).toBe(400);
      expect(body).toEqual({ statusCode: 400, error: 'Bad Request', message: 'CPF inválido' });
    });

    it('should refuse a request without the required fields', async () => {
      expect((await login({ cpf: CPF_GRANTED })).statusCode).toBe(400);
    });
  });

  /**
   * O que só este nível prova: a consulta desta função corresponde ao schema que
   * a API mantém. A unicidade do CPF é premissa da leitura — sem ela, `rows[0]`
   * escolheria em silêncio entre linhas concorrentes, e o PostgreSQL não promete
   * ordem estável sem `ORDER BY`.
   */
  describe('contract with the schema owned by the API', () => {
    it.each([
      ['users', 'cpf'],
      ['users', 'password_hash'],
      ['users', 'is_active'],
      ['customers', 'is_active'],
      ['user_customers', 'user_id'],
      ['user_customers', 'customer_id'],
    ])('should carry the column %s.%s the query depends on', async (table, column) => {
      const { rows } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
         ) AS exists`,
        [table, column],
      );

      expect(rows[0].exists).toBe(true);
    });

    it('should enforce the uniqueness of users.cpf the read relies on', async () => {
      const { rows } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_index i
           JOIN pg_class t ON t.oid = i.indrelid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
           WHERE t.relname = 'users' AND a.attname = 'cpf'
             AND i.indisunique AND i.indnatts = 1
         ) AS exists`,
      );

      expect(rows[0].exists).toBe(true);
    });

    /**
     * A comparação de bcrypt lança quando o hash armazenado não é texto. Uma
     * linha com `password_hash` nulo responderia `500` em vez de `401`, e a
     * indistinguibilidade das quatro causas de recusa — a propriedade central
     * desta função — deixaria de valer justamente para ela.
     */
    it('should keep users.password_hash non-nullable, the premise of the uniform 401', async () => {
      const { rows } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'password_hash'`,
      );

      expect(rows[0].is_nullable).toBe('NO');
    });
  });

  describe('logs', () => {
    it('should keep every emitted key inside the declared dictionary', () => {
      const emitted = mockLogLines
        .join('')
        .split('\n')
        .filter((line) => line.trim().startsWith('{'))
        .flatMap((line) => Object.keys(JSON.parse(line) as Record<string, unknown>));

      expect([...new Set(emitted)].filter((key) => !DECLARED_FIELD_NAMES.has(key))).toEqual([]);
    });

    it('should never write a password, a hash, a cpf or the issued token', () => {
      const rendered = mockLogLines.join('');

      expect(rendered).not.toContain(PASSWORD);
      expect(rendered).not.toContain('senha-errada');
      expect(rendered).not.toContain(CPF_GRANTED);
      expect(rendered).not.toContain('123.456.789-09');
      expect(rendered).not.toContain('$2b$');
      expect(rendered).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    });

    it('should mask the cpf into a stable correlator', () => {
      expect(mockLogLines.join('')).toContain('***.***.789-09');
    });
  });
});
