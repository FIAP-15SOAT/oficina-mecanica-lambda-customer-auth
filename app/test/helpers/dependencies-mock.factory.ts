import type { Pool } from 'pg';

import { ILogger } from '@application/ports/output/logger.service.interface';
import { AuthenticateCustomerUseCase } from '@application/use-cases/auth/authenticate-customer.use-case';
import { CustomerAuthController } from '@interface-adapters/auth/customer-auth.controller';
import { InvocationTimings } from '@infrastructure/observability/invocation-timings';

import type { Dependencies } from '../../src/bootstrap';
import { captureLog, LogCapture } from './log-capture';
import {
  createMockHashService,
  createMockIdentityRepository,
  createMockTokenIssuer,
} from './auth-mock.factory';

export interface MockDependencies {
  dependencies: Dependencies;
  capture: LogCapture;
  identityRepository: ReturnType<typeof createMockIdentityRepository>;
  hashService: ReturnType<typeof createMockHashService>;
  tokenIssuer: ReturnType<typeof createMockTokenIssuer>;
}

export function createMockDependencies(): MockDependencies {
  const capture = captureLog();
  const timings = new InvocationTimings();

  const identityRepository = createMockIdentityRepository();
  const hashService = createMockHashService();
  const tokenIssuer = createMockTokenIssuer();

  const dependencies: Dependencies = {
    timings,
    pool: {} as Pool,
    createController: (logger: ILogger) =>
      new CustomerAuthController(
        new AuthenticateCustomerUseCase(
          {
            findByCpf: (cpf) =>
              timings.measure('queryDurationMs', () => identityRepository.findByCpf(cpf)),
          },
          {
            compare: (value, hashed) =>
              timings.measure('passwordVerificationDurationMs', () =>
                hashService.compare(value, hashed),
              ),
          },
          tokenIssuer,
          logger,
        ),
      ),
  };

  return { dependencies, capture, identityRepository, hashService, tokenIssuer };
}
