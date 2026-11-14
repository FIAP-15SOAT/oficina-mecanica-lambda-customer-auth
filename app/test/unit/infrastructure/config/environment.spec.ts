import { loadEnvironment } from '@infrastructure/config/environment';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';

const MINIMUM: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  IDENTITY_INTERNAL_URL: 'http://internal-nlb.local:8081',
  WORK_ORDER_INTERNAL_URL: 'http://internal-nlb.local:80',
  CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID: 'oficina/customer-auth/jwt',
};

const PRODUCTION: NodeJS.ProcessEnv = { ...MINIMUM, NODE_ENV: 'production' };

describe('loadEnvironment', () => {
  it('should apply every documented default over the minimum set', () => {
    const environment = loadEnvironment(MINIMUM);

    expect(environment).toMatchObject({
      CUSTOMER_JWT_ISSUER: 'oficina-customer-auth',
      CUSTOMER_JWT_AUDIENCE: 'oficina-api',
      CUSTOMER_JWT_TTL_SECONDS: 3600,
      CUSTOMER_JWT_KEY_ID: 'customer-auth',
    });
  });

  it('should coerce the numeric variables from their string form', () => {
    const environment = loadEnvironment({
      ...MINIMUM,
      CUSTOMER_JWT_TTL_SECONDS: '900',
      LOG_LEVEL: 'debug',
    });

    expect(environment.CUSTOMER_JWT_TTL_SECONDS).toBe(900);
    expect(environment.LOG_LEVEL).toBe('debug');
  });

  it.each(['IDENTITY_INTERNAL_URL', 'WORK_ORDER_INTERNAL_URL'])(
    'should require IDENTITY_INTERNAL_URL and WORK_ORDER_INTERNAL_URL (%s)',
    (variable) => {
      const source = { ...MINIMUM };
      delete source[variable];

      expect(() => loadEnvironment(source)).toThrow(ConfigurationException);
      expect(() => loadEnvironment(source)).toThrow(variable);
    },
  );

  it.each([
    ['IDENTITY_INTERNAL_URL', 'ftp://internal-nlb.local:8081'],
    ['WORK_ORDER_INTERNAL_URL', 'internal-nlb.local:80'],
  ])('should refuse an internal url that is not http or https (%s)', (variable, value) => {
    expect(() => loadEnvironment({ ...MINIMUM, [variable]: value })).toThrow(variable);
  });

  it('should accept an internal url over https', () => {
    const environment = loadEnvironment({
      ...MINIMUM,
      IDENTITY_INTERNAL_URL: 'https://identity.local',
    });

    expect(environment.IDENTITY_INTERNAL_URL).toBe('https://identity.local');
  });

  it.each([
    ['CUSTOMER_JWT_TTL_SECONDS', '0'],
    ['CUSTOMER_JWT_TTL_SECONDS', 'não-é-número'],
    ['LOG_LEVEL', 'verbose'],
  ])('should fail when %s carries the invalid value "%s"', (variable, value) => {
    expect(() => loadEnvironment({ ...MINIMUM, [variable]: value })).toThrow(variable);
  });

  it('should accept the development fallbacks instead of the secret identifiers', () => {
    const environment = loadEnvironment({
      ...MINIMUM,
      CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID: undefined,
      CUSTOMER_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    });

    expect(environment.CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID).toBeUndefined();
    expect(environment.CUSTOMER_JWT_PRIVATE_KEY).toContain('PRIVATE KEY');
  });

  /**
   * The mode is enumerated and required because it is what allows a secret in
   * an environment variable. Missing or unknown, initialization fails instead
   * of assuming the most permissive mode.
   */
  it.each([undefined, 'prod', 'staging', ''])(
    'should refuse to start when NODE_ENV is %p',
    (value) => {
      const source = { ...MINIMUM, NODE_ENV: value };

      expect(() => loadEnvironment(source)).toThrow('NODE_ENV');
    },
  );

  it('should demand CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID in production', () => {
    const source = { ...PRODUCTION };
    delete source.CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID;

    expect(() => loadEnvironment(source)).toThrow('CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID');
  });

  /**
   * The fallback is not just discouraged in production: it is refused. A private
   * signing key in an environment variable is readable by anyone who can read
   * the function configuration, outside rotation and audit.
   */
  it('should refuse the CUSTOMER_JWT_PRIVATE_KEY fallback in production', () => {
    const source = {
      ...PRODUCTION,
      CUSTOMER_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    };

    expect(() => loadEnvironment(source)).toThrow(
      'CUSTOMER_JWT_PRIVATE_KEY não é aceito em produção',
    );
  });

  it('should still accept the fallbacks in test', () => {
    expect(
      loadEnvironment({
        ...MINIMUM,
        NODE_ENV: 'test',
        CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID: undefined,
        CUSTOMER_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
      }).NODE_ENV,
    ).toBe('test');
  });

  /**
   * A PEM does not cross an environment variable with its line breaks intact.
   * The escaped form is the only one that `.env` and the container descriptor
   * carry.
   */
  it('should restore the newlines of an escaped PEM', () => {
    const escaped = '-----BEGIN PRIVATE KEY-----\\nMIIB\\n-----END PRIVATE KEY-----\\n';

    const environment = loadEnvironment({ ...MINIMUM, CUSTOMER_JWT_PRIVATE_KEY: escaped });

    expect(environment.CUSTOMER_JWT_PRIVATE_KEY).toBe(
      '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
    );
  });

  it('should leave a PEM that already carries real newlines untouched', () => {
    const real = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n';

    expect(
      loadEnvironment({ ...MINIMUM, CUSTOMER_JWT_PRIVATE_KEY: real }).CUSTOMER_JWT_PRIVATE_KEY,
    ).toBe(real);
  });

  it('should demand an identifier or a fallback for the private key', () => {
    expect(() =>
      loadEnvironment({ ...MINIMUM, CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID: undefined }),
    ).toThrow('CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID');
  });

  it('should label a problem with no path as coming from the root', () => {
    expect(() => loadEnvironment(null as unknown as NodeJS.ProcessEnv)).toThrow('(raiz)');
  });

  it('should report every problem at once, naming each variable', () => {
    const error = (() => {
      try {
        loadEnvironment({ CUSTOMER_JWT_TTL_SECONDS: 'x' });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();

    expect(error?.message).toContain('IDENTITY_INTERNAL_URL');
    expect(error?.message).toContain('WORK_ORDER_INTERNAL_URL');
    expect(error?.message).toContain('CUSTOMER_JWT_TTL_SECONDS');
  });
});
