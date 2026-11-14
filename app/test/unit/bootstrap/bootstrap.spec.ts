import { createSecretResolver } from '@infrastructure/config/secret-resolver';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { TokenSigningException } from '@infrastructure/exceptions/token-signing.exception';
import { PinoLoggerAdapter } from '@infrastructure/logging/pino-logger.adapter';

import { getBaseLogger, getDependencies, resetDependencies } from '../../../src/bootstrap';
import { generateKeyPairSync } from 'node:crypto';

jest.mock('@infrastructure/config/secret-resolver', () => {
  const actual = jest.requireActual('@infrastructure/config/secret-resolver');

  return {
    ...actual,
    createSecretResolver: jest.fn(() => {
      const real = actual.createSecretResolver();

      return { resolve: jest.fn(real.resolve.bind(real)) };
    }),
  };
});

const resolverFactory = createSecretResolver as jest.MockedFunction<typeof createSecretResolver>;

const { privateKey: PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const ENVIRONMENT: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  IDENTITY_INTERNAL_URL: 'http://localhost:4010',
  WORK_ORDER_INTERNAL_URL: 'http://localhost:4010',
  CUSTOMER_JWT_PRIVATE_KEY: PRIVATE_KEY,
  CUSTOMER_JWT_KEY_ID: 'customer-auth-test',
  LOG_LEVEL: 'silent',
};

describe('bootstrap', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...ENVIRONMENT };
    resetDependencies();
    resolverFactory.mockClear();
  });

  afterEach(() => {
    resetDependencies();
    process.env = original;
  });

  it('should wire a controller able to answer an invocation', async () => {
    const dependencies = await getDependencies();

    expect(
      dependencies.createController(getBaseLogger(), {
        requestId: 'req-1',
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      }),
    ).toBeDefined();
  });

  /**
   * Memoization is why the composition lives in a single place: the secret and
   * the key import happen once per environment, not once per invocation.
   */
  it('should not fetch the secret again on a second call', async () => {
    const first = await getDependencies();
    const second = await getDependencies();

    expect(second).toBe(first);
    expect(resolverFactory).toHaveBeenCalledTimes(1);

    const resolver = resolverFactory.mock.results[0].value as { resolve: jest.Mock };

    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });
});

describe('bootstrap — initialization failure', () => {
  const original = process.env;

  beforeEach(() => {
    resetDependencies();
  });

  afterEach(() => {
    resetDependencies();
    process.env = original;
  });

  it('should fail immediately when a required variable is missing', async () => {
    process.env = { ...ENVIRONMENT, IDENTITY_INTERNAL_URL: undefined };

    await expect(getDependencies()).rejects.toThrow(ConfigurationException);
  });

  it('should fail while initializing when the private key is not a valid PEM', async () => {
    process.env = { ...ENVIRONMENT, CUSTOMER_JWT_PRIVATE_KEY: 'nem parece um PEM' };

    await expect(getDependencies()).rejects.toThrow(TokenSigningException);
  });

  /**
   * The two initialization failures are not the same thing to an operator:
   * invalid configuration is a deployment defect, and an unavailable secret is an
   * external dependency that may come back by itself. The event must tell them apart.
   */
  it.each([
    ['a missing required variable', { IDENTITY_INTERNAL_URL: undefined }],
    ['an unreadable PEM', { CUSTOMER_JWT_PRIVATE_KEY: 'nem parece um PEM' }],
  ])('should report a deployment defect as app.configuration.invalid — %s', async (_case, over) => {
    const event = jest.spyOn(PinoLoggerAdapter.prototype, 'event');

    process.env = { ...ENVIRONMENT, ...over };

    await expect(getDependencies()).rejects.toBeInstanceOf(Error);

    expect(event.mock.calls[0][0].name).toBe('app.configuration.invalid');

    event.mockRestore();
  });

  it('should report an unavailable dependency as app.initialization.failed', async () => {
    const event = jest.spyOn(PinoLoggerAdapter.prototype, 'event');

    resolverFactory.mockReturnValueOnce({
      resolve: () => Promise.reject(new Error('secrets manager indisponível')),
    });

    process.env = { ...ENVIRONMENT };

    await expect(getDependencies()).rejects.toThrow('secrets manager indisponível');

    expect(event.mock.calls[0][0].name).toBe('app.initialization.failed');

    event.mockRestore();
  });

  /**
   * A transient failure must not doom the environment to return the same
   * rejected promise forever.
   */
  it('should not memoize a failed initialization', async () => {
    process.env = { ...ENVIRONMENT, IDENTITY_INTERNAL_URL: undefined };

    await expect(getDependencies()).rejects.toThrow(ConfigurationException);

    process.env = { ...ENVIRONMENT };

    await expect(getDependencies()).resolves.toBeDefined();
  });
});
