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
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'techchallenge',
  DATABASE_SSL: 'false',
  DATABASE_SECRET: '{"username":"postgres","password":"postgres"}',
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

  afterEach(async () => {
    const dependencies = await getDependencies().catch(() => undefined);

    await dependencies?.pool.end();
    resetDependencies();
    process.env = original;
  });

  it('should wire a controller able to answer an invocation', async () => {
    const dependencies = await getDependencies();

    expect(dependencies.createController(getBaseLogger())).toBeDefined();
    expect(dependencies.pool).toBeDefined();
  });

  /**
   * A memoização é o motivo de a composição existir num ponto só: as três
   * inicializações caras ocorrem uma vez por ambiente, e não uma por invocação.
   */
  it('should not fetch the secrets again on a second call', async () => {
    const first = await getDependencies();
    const second = await getDependencies();

    expect(second).toBe(first);
    expect(resolverFactory).toHaveBeenCalledTimes(1);

    const resolver = resolverFactory.mock.results[0].value as { resolve: jest.Mock };

    expect(resolver.resolve).toHaveBeenCalledTimes(2);
  });

  it('should resolve the two secrets in parallel', async () => {
    await getDependencies();

    const resolver = resolverFactory.mock.results[0].value as { resolve: jest.Mock };

    // Duas chamadas disparadas antes de qualquer uma resolver: serializá-las
    // custaria uma ida de rede inteira no caminho frio.
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
  });

  it('should keep a single timings collector and a single pool per environment', async () => {
    const dependencies = await getDependencies();

    expect((await getDependencies()).timings).toBe(dependencies.timings);
    expect((await getDependencies()).pool).toBe(dependencies.pool);
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
    process.env = { ...ENVIRONMENT, DATABASE_HOST: undefined, LOG_LEVEL: 'silent' };

    await expect(getDependencies()).rejects.toThrow(ConfigurationException);
  });

  it('should fail while initializing when the private key is not a valid PEM', async () => {
    process.env = { ...ENVIRONMENT, CUSTOMER_JWT_PRIVATE_KEY: 'nem parece um PEM' };

    await expect(getDependencies()).rejects.toThrow(TokenSigningException);
  });

  /**
   * As duas falhas de inicialização não são a mesma coisa para quem opera:
   * configuração inválida é defeito de implantação, e segredo indisponível é
   * dependência externa que pode voltar sozinha. O evento precisa distingui-las.
   */
  it.each([
    ['a missing required variable', { DATABASE_HOST: undefined }],
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
   * Uma falha transitória não pode condenar o ambiente a devolver a mesma
   * promessa rejeitada para sempre.
   */
  it('should not memoize a failed initialization', async () => {
    process.env = { ...ENVIRONMENT, DATABASE_HOST: undefined, LOG_LEVEL: 'silent' };

    await expect(getDependencies()).rejects.toThrow(ConfigurationException);

    process.env = { ...ENVIRONMENT };

    const dependencies = await getDependencies();

    expect(dependencies.pool).toBeDefined();

    await dependencies.pool.end();
  });
});
