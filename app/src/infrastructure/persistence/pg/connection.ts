import { Pool, PoolConfig } from 'pg';

import { Environment } from '@infrastructure/config/environment';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';

export interface DatabaseCredentials {
  username: string;
  password: string;
}

/**
 * O segredo do banco chega como o JSON que o gerenciador de segredos guarda.
 * Ler os dois campos aqui — e não no ponto de uso — mantém o formato do segredo
 * confinado a uma função.
 */
export function parseDatabaseCredentials(raw: string): DatabaseCredentials {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationException('Segredo do banco não é um JSON válido');
  }

  const candidate = parsed as Partial<DatabaseCredentials>;

  if (typeof candidate?.username !== 'string' || typeof candidate?.password !== 'string') {
    throw new ConfigurationException('Segredo do banco deve conter "username" e "password"');
  }

  return { username: candidate.username, password: candidate.password };
}

/**
 * Pool de tamanho **um**: cada ambiente de execução atende uma invocação por
 * vez, então qualquer número maior é conexão ociosa consumindo um slot do
 * banco. Entre conexão única e pool de um, o pool ganha porque descarta e
 * reabre uma conexão que entrou em erro, sem esperar a reciclagem do ambiente.
 *
 * `idleTimeoutMillis: 0` desliga o encerramento por ociosidade — encerrar ao
 * fim da invocação destruiria o reaproveitamento que é a razão de existir da
 * decisão. O ambiente é congelado, não parado.
 */
export function buildPoolConfig(env: Environment, credentials: DatabaseCredentials): PoolConfig {
  return {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: credentials.username,
    password: credentials.password,
    max: 1,
    connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
    query_timeout: env.DATABASE_QUERY_TIMEOUT_MS,
    statement_timeout: env.DATABASE_QUERY_TIMEOUT_MS,
    idleTimeoutMillis: 0,
    allowExitOnIdle: false,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ssl: buildSslConfig(env),
  };
}

function buildSslConfig(env: Environment): PoolConfig['ssl'] {
  if (!env.DATABASE_SSL) {
    return false;
  }

  return {
    rejectUnauthorized: true,
    ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA } : {}),
  };
}

export function createPool(
  env: Environment,
  credentials: DatabaseCredentials,
  onIdleError: (error: Error) => void = () => undefined,
): Pool {
  const pool = new Pool(buildPoolConfig(env, credentials));

  pool.on('error', onIdleError);

  return pool;
}
