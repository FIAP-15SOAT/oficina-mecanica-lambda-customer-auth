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
import { IHashService } from '@application/ports/output/hash.service.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { ITokenIssuerService } from '@application/ports/output/token-issuer.service.interface';

import { CustomerUser } from '@domain/entities/customer-user.entity';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { ICustomerIdentityRepository } from '@domain/interfaces/repositories/customer-identity.repository.interface';
import { Cpf } from '@domain/value-objects/cpf.vo';

export class AuthenticateCustomerUseCase implements IAuthenticateCustomerUseCase {
  constructor(
    private readonly identityRepository: ICustomerIdentityRepository,
    private readonly hashService: IHashService,
    private readonly tokenIssuer: ITokenIssuerService,
    private readonly logger: ILogger,
  ) {}

  async execute(input: AuthenticateCustomerInputDto): Promise<AuthenticateCustomerOutputDto> {
    const cpf = this.parseCpf(input.cpf);
    const user = await this.identityRepository.findByCpf(cpf.value);

    if (!user) {
      this.reject('unknown_user', cpf);
    }

    if (!user.isActive) {
      this.reject('inactive_user', cpf, user);
    }

    if (!(await this.hashService.compare(input.password, user.passwordHash))) {
      this.reject('wrong_password', cpf, user);
    }

    if (!user.hasActiveCustomerLink) {
      this.reject('no_active_customer_link', cpf, user);
    }

    const { accessToken, expiresIn } = await this.tokenIssuer.issueAccessToken(user.id);

    this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_SUCCEEDED, {
      subjectId: user.id,
      maskedCpf: cpf.formatted,
    });

    return { accessToken, expiresIn };
  }

  private reject(reason: AuthenticationFailureReason, cpf: Cpf, user?: CustomerUser): never {
    this.logger.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
      failureReason: reason,
      maskedCpf: cpf.formatted,
      ...(user ? { subjectId: user.id } : {}),
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
