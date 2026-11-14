import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';

import { DECLARED_FIELD_NAMES } from '@infrastructure/logging/field-registry';

import { resetDependencies } from '../../src/bootstrap';
import { handler } from '../../src/handler';
import {
  readCustomerAuthenticationFixture,
  readUserCustomersFixture,
} from '../helpers/contract-fixtures';
import { InternalServicesStub, startInternalServicesStub } from '../helpers/internal-services-stub';
import { buildContext, buildJsonEvent } from '../helpers/platform-event.factory';

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

const CPF_GRANTED = '12345678909';
const CPF_NO_LINK = '11144477735';
const CPF_ABSENT = '98765432100';

const ISSUER = 'oficina-customer-auth';
const AUDIENCE = 'oficina-api';
const KEY_ID = 'customer-auth-test';

const IDENTITY_ROUTE = 'POST /internal/customer-authentications';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const { userId } = readCustomerAuthenticationFixture();
const userCustomersRoute = `GET /internal/users/${userId}/customers`;

async function login(body: Record<string, unknown>) {
  const response = await handler(buildJsonEvent(body), buildContext());

  return {
    statusCode: response.statusCode,
    body: JSON.parse(String(response.body)) as Record<string, unknown>,
  };
}

function parsedLogLines(): Record<string, unknown>[] {
  return mockLogLines
    .join('')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('customer authentication against the owners stubs', () => {
  let internalServicesStub: InternalServicesStub;
  const originalEnv = process.env;

  beforeAll(async () => {
    internalServicesStub = await startInternalServicesStub();

    internalServicesStub.credentials.set(CPF_GRANTED, { password: PASSWORD, userId });
    internalServicesStub.credentials.set(CPF_NO_LINK, { password: PASSWORD, userId: randomUUID() });
    internalServicesStub.userCustomers.set(userId, readUserCustomersFixture());

    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      // The trailing slash is how a local .env often writes it.
      IDENTITY_INTERNAL_URL: `${internalServicesStub.url}/`,
      WORK_ORDER_INTERNAL_URL: internalServicesStub.url,
      CUSTOMER_JWT_PRIVATE_KEY: privateKey,
      CUSTOMER_JWT_ISSUER: ISSUER,
      CUSTOMER_JWT_AUDIENCE: AUDIENCE,
      CUSTOMER_JWT_KEY_ID: KEY_ID,
    };

    resetDependencies();
  });

  beforeEach(() => {
    internalServicesStub.requests.length = 0;
    internalServicesStub.nextResponses.clear();
  });

  afterAll(async () => {
    resetDependencies();
    process.env = originalEnv;

    await internalServicesStub?.close();
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
      expect(verified.payload.sub).toBe(userId);
      expect(decodeProtectedHeader(accessToken).kid).toBe(KEY_ID);
      expect(JSON.stringify(verified.payload)).not.toContain(CPF_GRANTED);
    });

    it('should accept the cpf written with punctuation', async () => {
      expect((await login({ cpf: '123.456.789-09', password: PASSWORD })).statusCode).toBe(200);
    });
  });

  describe('credential rejection', () => {
    it('should answer identically for an unknown cpf, a wrong password and a user without an active customer', async () => {
      const responses = await Promise.all([
        login({ cpf: CPF_ABSENT, password: PASSWORD }),
        login({ cpf: CPF_GRANTED, password: 'senha-errada' }),
        login({ cpf: CPF_NO_LINK, password: PASSWORD }),
      ]);

      responses.forEach((response) => expect(response.statusCode).toBe(401));
      expect(new Set(responses.map((response) => JSON.stringify(response))).size).toBe(1);
    });
  });

  describe('invalid input', () => {
    it('should refuse an invalid cpf without calling the owners', async () => {
      const { statusCode, body } = await login({ cpf: '111.111.111-11', password: PASSWORD });

      expect(statusCode).toBe(400);
      expect(body).toEqual({ statusCode: 400, error: 'Bad Request', message: 'CPF inválido' });
      expect(internalServicesStub.requests).toEqual([]);
    });

    it('should refuse a request without the required fields', async () => {
      expect((await login({ cpf: CPF_GRANTED })).statusCode).toBe(400);
    });
  });

  describe('calls to the owners', () => {
    it('should send the same request id and trace id to both owners and log that trace id', async () => {
      await login({ cpf: CPF_GRANTED, password: PASSWORD });

      const [identityRequest, workOrderRequest] = internalServicesStub.requests;
      const traceId = String(identityRequest.headers.traceparent).split('-')[1];

      expect(identityRequest.headers['x-request-id']).toBe(buildContext().awsRequestId);

      expect(workOrderRequest.headers['x-request-id']).toBe(
        identityRequest.headers['x-request-id'],
      );

      expect(identityRequest.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(workOrderRequest.headers.traceparent).toBe(identityRequest.headers.traceparent);

      expect(parsedLogLines().map((line) => line.trace_id)).toEqual(
        expect.arrayContaining([traceId]),
      );
    });

    it('should ask each owner for a new connection', async () => {
      await login({ cpf: CPF_GRANTED, password: PASSWORD });

      expect(internalServicesStub.requests.map((request) => request.headers.connection)).toEqual([
        'close',
        'close',
      ]);
    });

    it('should reach the owner routes when the internal url ends with a slash', async () => {
      await login({ cpf: CPF_GRANTED, password: PASSWORD });

      expect(internalServicesStub.requests.map((request) => request.path)).toEqual([
        '/internal/customer-authentications',
        `/internal/users/${userId}/customers`,
      ]);
    });

    it('should answer 503 when the identity does not answer within 2 s', async () => {
      internalServicesStub.nextResponses.set(IDENTITY_ROUTE, {
        status: 200,
        body: { data: { userId } },
        delayMs: 2500,
      });

      expect((await login({ cpf: CPF_GRANTED, password: PASSWORD })).statusCode).toBe(503);
    });

    it('should answer 503 when the identity answers a redirect', async () => {
      internalServicesStub.nextResponses.set(IDENTITY_ROUTE, {
        status: 302,
        headers: { location: '/internal/elsewhere' },
      });

      expect((await login({ cpf: CPF_GRANTED, password: PASSWORD })).statusCode).toBe(503);
    });

    it('should answer 503 when the identity fails', async () => {
      internalServicesStub.nextResponses.set(IDENTITY_ROUTE, { status: 500 });

      expect((await login({ cpf: CPF_GRANTED, password: PASSWORD })).statusCode).toBe(503);
    });

    it('should answer 503 when the work order fails', async () => {
      internalServicesStub.nextResponses.set(userCustomersRoute, { status: 500 });

      expect((await login({ cpf: CPF_GRANTED, password: PASSWORD })).statusCode).toBe(503);
    });
  });

  describe('work order unreachable', () => {
    beforeAll(async () => {
      const closedStub = await startInternalServicesStub();

      await closedStub.close();

      process.env.WORK_ORDER_INTERNAL_URL = closedStub.url;
      resetDependencies();
    });

    it('should answer 503 when the work order refuses the connection', async () => {
      expect((await login({ cpf: CPF_GRANTED, password: PASSWORD })).statusCode).toBe(503);
    });
  });

  describe('logs', () => {
    it('should keep every emitted key inside the declared dictionary', () => {
      const emitted = parsedLogLines().flatMap((line) => Object.keys(line));

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
