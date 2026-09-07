import { Pool } from 'pg';

import { ILogger } from '@application/ports/output/logger.service.interface';
import { AuthenticateCustomerUseCase } from '@application/use-cases/auth/authenticate-customer.use-case';
import { CustomerAuthController } from '@interface-adapters/auth/customer-auth.controller';

import { createSecretResolver } from '@infrastructure/config/secret-resolver';
import { loadEnvironment } from '@infrastructure/config/environment';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { TokenSigningException } from '@infrastructure/exceptions/token-signing.exception';
import { createDefaultDestination } from '@infrastructure/logging/logging-destination';
import { createLogger } from '@infrastructure/logging/logger.factory';
import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';
import { PinoLoggerAdapter } from '@infrastructure/logging/pino-logger.adapter';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';
import { InvocationTimings } from '@infrastructure/observability/invocation-timings';
import { createPool, parseDatabaseCredentials } from '@infrastructure/persistence/pg/connection';
import { PgCustomerIdentityRepository } from '@infrastructure/persistence/pg/customer-identity.repository';
import { BcryptHashService } from '@infrastructure/security/bcrypt-hash.service';
import { JoseTokenIssuerService } from '@infrastructure/security/jose-token-issuer.service';

export interface Dependencies {
  timings: InvocationTimings;
  pool: Pool;
  createController(logger: ILogger): CustomerAuthController;
}

let cached: Promise<Dependencies> | undefined;
let baseLogger: PinoLoggerAdapter | undefined;

/**
 * Logger do ambiente de execução. Vive fora da composição memoizada porque o
 * ponto de entrada precisa dele **mesmo quando a composição falha**: sem isso, o
 * 500 de inicialização sairia sem linha de atendimento e sem correlação.
 */
export function getBaseLogger(): PinoLoggerAdapter {
  if (!baseLogger) {
    const { level, resource } = resolveLoggerConfig();

    baseLogger = new PinoLoggerAdapter(createLogger(createDefaultDestination(), level, resource));
  }

  return baseLogger;
}

export function getDependencies(): Promise<Dependencies> {
  cached ??= build().catch((error: unknown) => {
    cached = undefined;

    throw error;
  });

  return cached;
}

/**
 * Encerra o pool **se ele chegou a existir**, lendo a composição memoizada sem
 * dispará-la. Existe para o script local e para o teste, não para o runtime: na
 * plataforma o ambiente é congelado, e encerrar destruiria o reaproveitamento.
 *
 * Ler `cached` em vez de chamar `getDependencies()` é o ponto: uma composição
 * que falhou não é memoizada, então chamá-la aqui recomporia tudo e registraria
 * a mesma falha uma segunda vez.
 */
export async function closeDependencies(): Promise<void> {
  await cached?.then(
    (dependencies) => dependencies.pool.end(),
    () => undefined,
  );
}

/** Descarta a composição memoizada. Existe para o teste, não para o runtime. */
export function resetDependencies(): void {
  cached = undefined;
  baseLogger = undefined;
}

async function build(): Promise<Dependencies> {
  const logger = getBaseLogger();

  try {
    return await compose(logger);
  } catch (error) {
    logger.event(resolveInitializationEvent(error), {}, error);

    throw error;
  }
}

function resolveInitializationEvent(error: unknown) {
  return error instanceof ConfigurationException || error instanceof TokenSigningException
    ? TECHNICAL_EVENTS.CONFIGURATION_INVALID
    : TECHNICAL_EVENTS.INITIALIZATION_FAILED;
}

async function compose(logger: PinoLoggerAdapter): Promise<Dependencies> {
  const environment = loadEnvironment();
  const secrets = createSecretResolver();

  const [databaseSecret, privateKeyPem] = await Promise.all([
    secrets.resolve({
      secretId: environment.DATABASE_SECRET_ID,
      fallback: environment.DATABASE_SECRET,
    }),
    secrets.resolve({
      secretId: environment.CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID,
      fallback: environment.CUSTOMER_JWT_PRIVATE_KEY,
    }),
  ]);

  const timings = new InvocationTimings();

  const pool = createPool(environment, parseDatabaseCredentials(databaseSecret), (error) =>
    logger.error('idle database client failed', error),
  );

  const tokenIssuer = await JoseTokenIssuerService.create(privateKeyPem, {
    issuer: environment.CUSTOMER_JWT_ISSUER,
    audience: environment.CUSTOMER_JWT_AUDIENCE,
    ttlSeconds: environment.CUSTOMER_JWT_TTL_SECONDS,
    keyId: environment.CUSTOMER_JWT_KEY_ID,
  });

  const identityRepository = new PgCustomerIdentityRepository(pool, timings);
  const hashService = new BcryptHashService(timings);

  return {
    timings,
    pool,
    createController: (invocationLogger: ILogger) =>
      new CustomerAuthController(
        new AuthenticateCustomerUseCase(
          identityRepository,
          hashService,
          tokenIssuer,
          invocationLogger,
        ),
      ),
  };
}
