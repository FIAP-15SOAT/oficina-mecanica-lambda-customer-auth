import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';
import { AuthenticateCustomerUseCase } from '@application/use-cases/auth/authenticate-customer.use-case';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { Cpf } from '@domain/value-objects/cpf.vo';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';

import {
  createMockIdentityCustomerCredentialsGateway,
  createMockLogger,
  createMockTokenIssuer,
  createMockWorkOrderUserCustomersGateway,
  FORMATTED_CPF,
  VALID_CPF,
} from '../../helpers/auth-mock.factory';
import {
  readCustomerAuthenticationFixture,
  readUserCustomersFixture,
} from '../../helpers/contract-fixtures';

const USER_ID = readCustomerAuthenticationFixture().userId;

describe('AuthenticateCustomerUseCase', () => {
  let useCase: AuthenticateCustomerUseCase;
  let identityCustomerCredentialsGateway: ReturnType<
    typeof createMockIdentityCustomerCredentialsGateway
  >;
  let workOrderUserCustomersGateway: ReturnType<typeof createMockWorkOrderUserCustomersGateway>;
  let tokenIssuer: ReturnType<typeof createMockTokenIssuer>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    identityCustomerCredentialsGateway = createMockIdentityCustomerCredentialsGateway();

    workOrderUserCustomersGateway = createMockWorkOrderUserCustomersGateway();

    tokenIssuer = createMockTokenIssuer();

    logger = createMockLogger();

    useCase = new AuthenticateCustomerUseCase(
      identityCustomerCredentialsGateway,
      workOrderUserCustomersGateway,
      tokenIssuer,
      logger,
    );
  });

  it('should issue a token for the user the identity accepted when the work order returns an active customer', async () => {
    identityCustomerCredentialsGateway.authenticate.mockResolvedValue(
      readCustomerAuthenticationFixture(),
    );
    workOrderUserCustomersGateway.findActiveByUserId.mockResolvedValue(readUserCustomersFixture());

    const result = await useCase.execute({ cpf: FORMATTED_CPF, password: 'Senha@123' });

    expect(result).toEqual({ accessToken: 'jwt.token.value', expiresIn: 3600 });
    expect(workOrderUserCustomersGateway.findActiveByUserId).toHaveBeenCalledWith(USER_ID);
    expect(tokenIssuer.issueAccessToken).toHaveBeenCalledWith(USER_ID);

    expect(logger.eventNamed('auth.customer.authentication.succeeded')).toMatchObject({
      level: 'info',
      fields: { subjectId: USER_ID, maskedCpf: FORMATTED_CPF },
    });
  });

  it('should send the normalized cpf to the identity', async () => {
    await useCase.execute({ cpf: '123 456 789 09', password: 'Senha@123' }).catch(() => undefined);

    expect(identityCustomerCredentialsGateway.authenticate).toHaveBeenCalledWith(
      VALID_CPF,
      'Senha@123',
    );
  });

  it('should not carry personal data in the output', async () => {
    identityCustomerCredentialsGateway.authenticate.mockResolvedValue(
      readCustomerAuthenticationFixture(),
    );
    workOrderUserCustomersGateway.findActiveByUserId.mockResolvedValue(readUserCustomersFixture());

    const result = await useCase.execute({ cpf: VALID_CPF, password: 'Senha@123' });

    expect(Object.keys(result).sort()).toEqual(['accessToken', 'expiresIn']);
    expect(JSON.stringify(result)).not.toContain(VALID_CPF);
    expect(JSON.stringify(result)).not.toContain(USER_ID);
  });

  describe('credential rejection', () => {
    it('should refuse with credential_refused without asking the work order', async () => {
      await expect(useCase.execute({ cpf: FORMATTED_CPF, password: 'x' })).rejects.toThrow(
        UnauthorizedAccessException,
      );

      expect(workOrderUserCustomersGateway.findActiveByUserId).not.toHaveBeenCalled();

      expect(logger.eventNamed('auth.customer.authentication.failed')).toEqual({
        name: 'auth.customer.authentication.failed',
        level: 'warn',
        fields: { failureReason: 'credential_refused', maskedCpf: FORMATTED_CPF },
      });
    });

    it('should refuse with no_active_customer_link carrying the user id', async () => {
      identityCustomerCredentialsGateway.authenticate.mockResolvedValue(
        readCustomerAuthenticationFixture(),
      );

      await expect(useCase.execute({ cpf: FORMATTED_CPF, password: 'x' })).rejects.toThrow(
        UnauthorizedAccessException,
      );

      expect(tokenIssuer.issueAccessToken).not.toHaveBeenCalled();

      expect(logger.eventNamed('auth.customer.authentication.failed')).toMatchObject({
        level: 'warn',
        fields: {
          failureReason: 'no_active_customer_link',
          maskedCpf: FORMATTED_CPF,
          subjectId: USER_ID,
        },
      });
    });

    it('should throw the same UnauthorizedAccessException for both refusals', async () => {
      const credentialRefused = await useCase
        .execute({ cpf: VALID_CPF, password: 'x' })
        .catch((error: Error) => error);

      identityCustomerCredentialsGateway.authenticate.mockResolvedValue(
        readCustomerAuthenticationFixture(),
      );

      const noActiveCustomerLink = await useCase
        .execute({ cpf: VALID_CPF, password: 'x' })
        .catch((error: Error) => error);

      expect(credentialRefused).toBeInstanceOf(UnauthorizedAccessException);
      expect(noActiveCustomerLink).toEqual(credentialRefused);
    });

    it('should emit exactly one business event per attempt', async () => {
      await useCase.execute({ cpf: VALID_CPF, password: 'x' }).catch(() => undefined);

      expect(logger.events).toHaveLength(1);
    });
  });

  describe('owner failures', () => {
    it('should propagate an identity failure without asking the work order', async () => {
      const failure = new ServiceIntegrationException('POST /internal/customer-authentications');

      identityCustomerCredentialsGateway.authenticate.mockRejectedValue(failure);

      await expect(useCase.execute({ cpf: VALID_CPF, password: 'x' })).rejects.toBe(failure);

      expect(workOrderUserCustomersGateway.findActiveByUserId).not.toHaveBeenCalled();
      expect(logger.events).toHaveLength(0);
    });

    it('should propagate a work order failure without issuing a token', async () => {
      const failure = new ServiceIntegrationException(`GET /internal/users/${USER_ID}/customers`);

      identityCustomerCredentialsGateway.authenticate.mockResolvedValue(
        readCustomerAuthenticationFixture(),
      );
      workOrderUserCustomersGateway.findActiveByUserId.mockRejectedValue(failure);

      await expect(useCase.execute({ cpf: VALID_CPF, password: 'x' })).rejects.toBe(failure);

      expect(tokenIssuer.issueAccessToken).not.toHaveBeenCalled();
      expect(logger.events).toHaveLength(0);
    });
  });

  describe('invalid cpf', () => {
    it('should reject an invalid cpf without calling the identity or the work order', async () => {
      await expect(useCase.execute({ cpf: '111.111.111-11', password: 'x' })).rejects.toThrow(
        DomainValidationException,
      );

      expect(identityCustomerCredentialsGateway.authenticate).not.toHaveBeenCalled();
      expect(workOrderUserCustomersGateway.findActiveByUserId).not.toHaveBeenCalled();

      expect(logger.eventNamed('auth.customer.input.rejected')).toMatchObject({
        level: 'warn',
        fields: { failureReason: 'invalid_cpf' },
      });
    });

    it('should not put the rejected cpf in the log fields', async () => {
      await useCase.execute({ cpf: '111.111.111-11', password: 'x' }).catch(() => undefined);

      expect(JSON.stringify(logger.events)).not.toContain('111');
    });

    /**
     * The `instanceof` in the `catch` is not extra care: without it, a failure
     * unrelated to validation would be logged as `invalid_cpf` and point the
     * diagnosis the wrong way.
     */
    it('should rethrow a non-domain failure raised while parsing without logging it', async () => {
      const create = jest.spyOn(Cpf, 'create').mockImplementation(() => {
        throw new RangeError('quebrou');
      });

      await expect(useCase.execute({ cpf: VALID_CPF, password: 'x' })).rejects.toThrow(RangeError);

      expect(logger.events).toHaveLength(0);

      create.mockRestore();
    });
  });
});
