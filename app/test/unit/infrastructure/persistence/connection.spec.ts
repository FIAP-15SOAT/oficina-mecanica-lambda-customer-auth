import { Environment } from '@infrastructure/config/environment';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import {
  buildPoolConfig,
  createPool,
  parseDatabaseCredentials,
} from '@infrastructure/persistence/pg/connection';

const CREDENTIALS = { username: 'oficina_ro', password: 'super-secreta' };

const ENVIRONMENT = {
  DATABASE_HOST: 'db.internal',
  DATABASE_PORT: 5432,
  DATABASE_NAME: 'techchallenge',
  DATABASE_CONNECTION_TIMEOUT_MS: 3000,
  DATABASE_QUERY_TIMEOUT_MS: 5000,
  DATABASE_SSL: true,
} as Environment;

describe('parseDatabaseCredentials', () => {
  it('should read the two fields the secret carries', () => {
    expect(parseDatabaseCredentials(JSON.stringify(CREDENTIALS))).toEqual(CREDENTIALS);
  });

  it('should reject a secret that is not valid JSON', () => {
    expect(() => parseDatabaseCredentials('not-json')).toThrow(ConfigurationException);
  });

  it.each([
    ['without username', '{"password":"x"}'],
    ['without password', '{"username":"x"}'],
    ['with wrong types', '{"username":1,"password":2}'],
    ['that is null', 'null'],
  ])('should reject a secret %s', (_case, raw) => {
    expect(() => parseDatabaseCredentials(raw)).toThrow('username');
  });
});

describe('buildPoolConfig', () => {
  it('should keep a single connection per execution environment', () => {
    expect(buildPoolConfig(ENVIRONMENT, CREDENTIALS).max).toBe(1);
  });

  it('should bound both the acquisition and the query, instead of waiting forever', () => {
    const config = buildPoolConfig(ENVIRONMENT, CREDENTIALS);

    expect(config.connectionTimeoutMillis).toBe(3000);
    expect(config.query_timeout).toBe(5000);
    expect(config.statement_timeout).toBe(5000);
  });

  it('should never close the connection for being idle', () => {
    const config = buildPoolConfig(ENVIRONMENT, CREDENTIALS);

    expect(config.idleTimeoutMillis).toBe(0);
    expect(config.allowExitOnIdle).toBe(false);
    expect(config.keepAlive).toBe(true);
  });

  it('should carry the endpoint and the credentials from the secret', () => {
    expect(buildPoolConfig(ENVIRONMENT, CREDENTIALS)).toMatchObject({
      host: 'db.internal',
      port: 5432,
      database: 'techchallenge',
      user: 'oficina_ro',
      password: 'super-secreta',
    });
  });

  /**
   * A propriedade que trava a decisão: nenhum caminho deste arquivo produz
   * `rejectUnauthorized: false`. Desligar o TLS por completo é possível fora de
   * produção — e só isso —, para falar com o PostgreSQL local.
   */
  it('should verify the server certificate on every configuration that uses TLS', () => {
    const configurations = [
      buildPoolConfig(ENVIRONMENT, CREDENTIALS),
      buildPoolConfig(
        { ...ENVIRONMENT, DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----' },
        CREDENTIALS,
      ),
      buildPoolConfig({ ...ENVIRONMENT, DATABASE_SSL: false }, CREDENTIALS),
    ];

    for (const config of configurations) {
      if (config.ssl === false) {
        continue;
      }

      expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
    }

    expect(JSON.stringify(configurations)).not.toContain('"rejectUnauthorized":false');
  });

  it('should pin the expected certificate authority when one is configured', () => {
    const config = buildPoolConfig(
      { ...ENVIRONMENT, DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----' },
      CREDENTIALS,
    );

    expect(config.ssl).toMatchObject({ ca: '-----BEGIN CERTIFICATE-----' });
  });

  it('should drop TLS entirely only when it is turned off', () => {
    expect(buildPoolConfig({ ...ENVIRONMENT, DATABASE_SSL: false }, CREDENTIALS).ssl).toBe(false);
  });
});

describe('createPool', () => {
  it('should listen for idle client failures so a broken connection heals itself', () => {
    const onIdleError = jest.fn();
    const pool = createPool(ENVIRONMENT, CREDENTIALS, onIdleError);

    pool.emit('error', new Error('connection terminated'), undefined);

    expect(onIdleError).toHaveBeenCalledWith(expect.any(Error), undefined);

    return pool.end();
  });

  it('should tolerate an idle failure with no handler supplied', () => {
    const pool = createPool(ENVIRONMENT, CREDENTIALS);

    expect(() => pool.emit('error', new Error('x'), undefined)).not.toThrow();

    return pool.end();
  });
});
