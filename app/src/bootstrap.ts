import { ILogger } from '@application/ports/output/logger.service.interface';
import { AuthenticateCustomerUseCase } from '@application/use-cases/auth/authenticate-customer.use-case';
import { CustomerAuthController } from '@interface-adapters/auth/customer-auth.controller';

import {
  InternalCallContext,
  InternalHttpClient,
} from '@infrastructure/clients/internal-http-client';
import { createSecretResolver } from '@infrastructure/config/secret-resolver';
import { loadEnvironment } from '@infrastructure/config/environment';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { TokenSigningException } from '@infrastructure/exceptions/token-signing.exception';
import { createDefaultDestination } from '@infrastructure/logging/logging-destination';
import { createLogger } from '@infrastructure/logging/logger.factory';
import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';
import { PinoLoggerAdapter } from '@infrastructure/logging/pino-logger.adapter';
import { HttpIdentityCustomerCredentialsGateway } from '@infrastructure/gateways/identity/http-identity-customer-credentials-gateway';
import { HttpWorkOrderUserCustomersGateway } from '@infrastructure/gateways/work-order/http-work-order-user-customers-gateway';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';
import { JoseTokenIssuerService } from '@infrastructure/security/jose-token-issuer.service';

export interface Dependencies {
  createController(logger: ILogger, callContext: InternalCallContext): CustomerAuthController;
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

/** Descarta a composição memoizada. Existe para o teste, não para o runtime. */
export function resetDependencies(): void {
  cached = undefined;
  baseLogger = undefined;
}

async function build(): Promise<Dependencies> {
  const logger = getBaseLogger();

  try {
    return await compose();
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

async function compose(): Promise<Dependencies> {
  const environment = loadEnvironment();

  const privateKeyPem = await createSecretResolver().resolve({
    secretId: environment.CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID,
    fallback: environment.CUSTOMER_JWT_PRIVATE_KEY,
  });

  const tokenIssuer = await JoseTokenIssuerService.create(privateKeyPem, {
    issuer: environment.CUSTOMER_JWT_ISSUER,
    audience: environment.CUSTOMER_JWT_AUDIENCE,
    ttlSeconds: environment.CUSTOMER_JWT_TTL_SECONDS,
    keyId: environment.CUSTOMER_JWT_KEY_ID,
  });

  return {
    createController: (invocationLogger: ILogger, callContext: InternalCallContext) => {
      // One client per invocation: it carries that invocation's request id and traceparent.
      const internalHttpClient = new InternalHttpClient(callContext);

      return new CustomerAuthController(
        new AuthenticateCustomerUseCase(
          new HttpIdentityCustomerCredentialsGateway(
            internalHttpClient,
            environment.IDENTITY_INTERNAL_URL,
          ),
          new HttpWorkOrderUserCustomersGateway(
            internalHttpClient,
            environment.WORK_ORDER_INTERNAL_URL,
          ),
          tokenIssuer,
          invocationLogger,
        ),
      );
    },
  };
}
