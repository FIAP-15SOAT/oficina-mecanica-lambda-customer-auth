import { loadEnvironment } from '@infrastructure/config/environment';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';

const MINIMUM: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_HOST: 'db.internal',
  DATABASE_NAME: 'techchallenge',
  DATABASE_SECRET_ID: 'oficina/customer-auth/database',
  CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID: 'oficina/customer-auth/jwt',
};

const PRODUCTION: NodeJS.ProcessEnv = { ...MINIMUM, NODE_ENV: 'production' };

describe('loadEnvironment', () => {
  it('should apply every documented default over the minimum set', () => {
    const environment = loadEnvironment(MINIMUM);

    expect(environment).toMatchObject({
      DATABASE_PORT: 5432,
      DATABASE_CONNECTION_TIMEOUT_MS: 3000,
      DATABASE_QUERY_TIMEOUT_MS: 5000,
      DATABASE_SSL: true,
      CUSTOMER_JWT_ISSUER: 'oficina-customer-auth',
      CUSTOMER_JWT_AUDIENCE: 'oficina-api',
      CUSTOMER_JWT_TTL_SECONDS: 3600,
      CUSTOMER_JWT_KEY_ID: 'customer-auth',
    });
  });

  it('should coerce the numeric and boolean variables from their string form', () => {
    const environment = loadEnvironment({
      ...MINIMUM,
      DATABASE_PORT: '6543',
      DATABASE_CONNECTION_TIMEOUT_MS: '1500',
      DATABASE_QUERY_TIMEOUT_MS: '2500',
      DATABASE_SSL: 'false',
      CUSTOMER_JWT_TTL_SECONDS: '900',
      LOG_LEVEL: 'debug',
    });

    expect(environment.DATABASE_PORT).toBe(6543);
    expect(environment.DATABASE_CONNECTION_TIMEOUT_MS).toBe(1500);
    expect(environment.DATABASE_QUERY_TIMEOUT_MS).toBe(2500);
    expect(environment.DATABASE_SSL).toBe(false);
    expect(environment.CUSTOMER_JWT_TTL_SECONDS).toBe(900);
    expect(environment.LOG_LEVEL).toBe('debug');
  });

  it.each([
    ['DATABASE_HOST', 'DATABASE_HOST'],
    ['DATABASE_NAME', 'DATABASE_NAME'],
  ])('should fail when the required variable %s is absent', (variable, expected) => {
    const source = { ...MINIMUM };
    delete source[variable];

    expect(() => loadEnvironment(source)).toThrow(ConfigurationException);
    expect(() => loadEnvironment(source)).toThrow(expected);
  });

  it.each([
    ['DATABASE_PORT', '0'],
    ['DATABASE_PORT', '70000'],
    ['DATABASE_PORT', 'não-é-número'],
    ['DATABASE_QUERY_TIMEOUT_MS', '-1'],
    ['CUSTOMER_JWT_TTL_SECONDS', '0'],
    ['LOG_LEVEL', 'verbose'],
    ['DATABASE_SSL', 'talvez'],
  ])('should fail when %s carries the invalid value "%s"', (variable, value) => {
    expect(() => loadEnvironment({ ...MINIMUM, [variable]: value })).toThrow(variable);
  });

  it('should accept the development fallbacks instead of the secret identifiers', () => {
    const environment = loadEnvironment({
      NODE_ENV: 'development',
      DATABASE_HOST: 'localhost',
      DATABASE_NAME: 'techchallenge',
      DATABASE_SECRET: '{"username":"postgres","password":"postgres"}',
      CUSTOMER_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    });

    expect(environment.DATABASE_SECRET_ID).toBeUndefined();
    expect(environment.DATABASE_SECRET).toContain('postgres');
  });

  /**
   * O modo é enumerado e obrigatório porque é ele que libera segredo em
   * variável de ambiente e TLS desligado. Ausente ou desconhecido, a
   * inicialização falha em vez de assumir o modo mais permissivo.
   */
  it.each([undefined, 'prod', 'staging', ''])(
    'should refuse to start when NODE_ENV is %p',
    (value) => {
      const source = { ...MINIMUM, NODE_ENV: value };

      expect(() => loadEnvironment(source)).toThrow('NODE_ENV');
    },
  );

  it.each(['DATABASE_SECRET_ID', 'CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID'])(
    'should demand %s in production',
    (variable) => {
      const source = { ...PRODUCTION };
      delete source[variable];

      expect(() => loadEnvironment(source)).toThrow(variable);
    },
  );

  /**
   * O fallback não é apenas desencorajado em produção: é recusado. Uma chave
   * privada de assinatura em variável de ambiente fica legível para quem puder
   * ler a configuração da função, fora de rotação e de auditoria.
   */
  it.each([
    ['DATABASE_SECRET', '{"username":"postgres","password":"postgres"}'],
    ['CUSTOMER_JWT_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----'],
  ])('should refuse the %s fallback in production', (variable, value) => {
    expect(() => loadEnvironment({ ...PRODUCTION, [variable]: value })).toThrow(
      `${variable} não é aceito em produção`,
    );
  });

  it('should still accept the fallbacks in test', () => {
    expect(
      loadEnvironment({
        NODE_ENV: 'test',
        DATABASE_HOST: 'localhost',
        DATABASE_NAME: 'techchallenge',
        DATABASE_SECRET: '{"username":"postgres","password":"postgres"}',
        CUSTOMER_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
      }).NODE_ENV,
    ).toBe('test');
  });

  /**
   * Um PEM não atravessa uma variável de ambiente com as quebras de linha
   * intactas. A forma escapada é a única que `.env` e o descritor de contêiner
   * transportam.
   */
  it('should restore the newlines of an escaped PEM', () => {
    const escaped = '-----BEGIN PRIVATE KEY-----\\nMIIB\\n-----END PRIVATE KEY-----\\n';

    const environment = loadEnvironment({
      ...MINIMUM,
      CUSTOMER_JWT_PRIVATE_KEY: escaped,
      DATABASE_SSL_CA: escaped,
    });

    expect(environment.CUSTOMER_JWT_PRIVATE_KEY).toBe(
      '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
    );
    expect(environment.DATABASE_SSL_CA).toContain('\nMIIB');
  });

  it('should leave a PEM that already carries real newlines untouched', () => {
    const real = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n';

    expect(
      loadEnvironment({ ...MINIMUM, CUSTOMER_JWT_PRIVATE_KEY: real }).CUSTOMER_JWT_PRIVATE_KEY,
    ).toBe(real);
  });

  it('should demand an identifier or a fallback for each secret', () => {
    expect(() =>
      loadEnvironment({ NODE_ENV: 'development', DATABASE_HOST: 'h', DATABASE_NAME: 'n' }),
    ).toThrow('DATABASE_SECRET_ID');

    expect(() =>
      loadEnvironment({ ...MINIMUM, CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID: undefined }),
    ).toThrow('CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID');
  });

  /**
   * Desligar o TLS existe para o PostgreSQL local, que não o expõe. Em produção
   * é recusado — e a verificação de certificado nunca é desligada em caminho
   * algum.
   */
  it('should refuse to disable TLS in production', () => {
    expect(() =>
      loadEnvironment({ ...MINIMUM, NODE_ENV: 'production', DATABASE_SSL: 'false' }),
    ).toThrow('DATABASE_SSL=false não é aceito em produção');

    expect(loadEnvironment({ ...MINIMUM, NODE_ENV: 'production' }).DATABASE_SSL).toBe(true);
  });

  it('should label a problem with no path as coming from the root', () => {
    expect(() => loadEnvironment(null as unknown as NodeJS.ProcessEnv)).toThrow('(raiz)');
  });

  it('should report every problem at once, naming each variable', () => {
    const error = (() => {
      try {
        loadEnvironment({ DATABASE_PORT: 'x' });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();

    expect(error?.message).toContain('DATABASE_HOST');
    expect(error?.message).toContain('DATABASE_NAME');
    expect(error?.message).toContain('DATABASE_PORT');
  });
});
