import { ILogger } from '@application/ports/output/logger.service.interface';
import { AuthenticateCustomerUseCase } from '@application/use-cases/auth/authenticate-customer.use-case';
import { CustomerAuthController } from '@interface-adapters/auth/customer-auth.controller';
import { InternalCallContext } from '@infrastructure/clients/internal-http-client';

import type { Dependencies } from '../../src/bootstrap';
import { captureLog, LogCapture } from './log-capture';
import {
  createMockIdentityCustomerCredentialsGateway,
  createMockTokenIssuer,
  createMockWorkOrderUserCustomersGateway,
} from './auth-mock.factory';

export interface MockDependencies {
  dependencies: jest.Mocked<Dependencies>;
  capture: LogCapture;
  identityCustomerCredentialsGateway: ReturnType<
    typeof createMockIdentityCustomerCredentialsGateway
  >;
  workOrderUserCustomersGateway: ReturnType<typeof createMockWorkOrderUserCustomersGateway>;
  tokenIssuer: ReturnType<typeof createMockTokenIssuer>;
}

export function createMockDependencies(): MockDependencies {
  const capture = captureLog();
  const identityCustomerCredentialsGateway = createMockIdentityCustomerCredentialsGateway();
  const workOrderUserCustomersGateway = createMockWorkOrderUserCustomersGateway();
  const tokenIssuer = createMockTokenIssuer();

  const dependencies: jest.Mocked<Dependencies> = {
    createController: jest.fn(
      (logger: ILogger, _callContext: InternalCallContext) =>
        new CustomerAuthController(
          new AuthenticateCustomerUseCase(
            identityCustomerCredentialsGateway,
            workOrderUserCustomersGateway,
            tokenIssuer,
            logger,
          ),
        ),
    ),
  };

  return {
    dependencies,
    capture,
    identityCustomerCredentialsGateway,
    workOrderUserCustomersGateway,
    tokenIssuer,
  };
}
