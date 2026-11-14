import {
  AuthenticationFailureReason,
  BUSINESS_EVENTS,
} from '@application/logging/business-event.catalog';
import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';
import {
  AuthenticateCustomerInputDto,
  AuthenticateCustomerOutputDto,
} from '@application/ports/input/auth/dto/authenticate-customer.dto';
import { IAuthenticateCustomerUseCase } from '@application/ports/input/auth/authenticate-customer.use-case.interface';
import { IIdentityCustomerCredentialsGateway } from '@application/ports/output/gateways/identity/identity-customer-credentials-gateway.interface';
import { IWorkOrderUserCustomersGateway } from '@application/ports/output/gateways/work-order/work-order-user-customers-gateway.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { ITokenIssuerService } from '@application/ports/output/token-issuer.service.interface';

import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { Cpf } from '@domain/value-objects/cpf.vo';

export class AuthenticateCustomerUseCase implements IAuthenticateCustomerUseCase {
  constructor(
    private readonly identityCustomerCredentialsGateway: IIdentityCustomerCredentialsGateway,
    private readonly workOrderUserCustomersGateway: IWorkOrderUserCustomersGateway,
    private readonly tokenIssuer: ITokenIssuerService,
    private readonly logger: ILogger,
  ) {}

  async execute(input: AuthenticateCustomerInputDto): Promise<AuthenticateCustomerOutputDto> {
    const cpf = this.parseCpf(input.cpf);

    const credential = await this.identityCustomerCredentialsGateway.authenticate(
      cpf.value,
      input.password,
    );

    if (!credential) {
      this.reject('credential_refused', cpf);
    }

    const customers = await this.workOrderUserCustomersGateway.findActiveByUserId(
      credential.userId,
    );

    if (customers.length === 0) {
      this.reject('no_active_customer_link', cpf, credential.userId);
    }

    const { accessToken, expiresIn } = await this.tokenIssuer.issueAccessToken(credential.userId);

    this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_SUCCEEDED, {
      subjectId: credential.userId,
      maskedCpf: cpf.formatted,
    });

    return { accessToken, expiresIn };
  }

  private reject(reason: AuthenticationFailureReason, cpf: Cpf, subjectId?: string): never {
    this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
      failureReason: reason,
      maskedCpf: cpf.formatted,
      ...(subjectId ? { subjectId } : {}),
    });

    throw new UnauthorizedAccessException();
  }

  private parseCpf(value: string): Cpf {
    try {
      return Cpf.create(value);
    } catch (error) {
      if (error instanceof DomainValidationException) {
        this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_INPUT_REJECTED, {
          failureReason: 'invalid_cpf',
        });
      }

      throw error;
    }
  }
}
