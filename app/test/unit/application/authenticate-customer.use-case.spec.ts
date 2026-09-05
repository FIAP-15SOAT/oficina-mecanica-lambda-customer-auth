import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';
import { AuthenticateCustomerUseCase } from '@application/use-cases/auth/authenticate-customer.use-case';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { Cpf } from '@domain/value-objects/cpf.vo';

import {
  createMockCustomerUser,
  createMockHashService,
  createMockIdentityRepository,
  createMockLogger,
  createMockTokenIssuer,
  FORMATTED_CPF,
  STORED_HASH,
  SUBJECT_ID,
  VALID_CPF,
} from '../../helpers/auth-mock.factory';

describe('AuthenticateCustomerUseCase', () => {
  let useCase: AuthenticateCustomerUseCase;
  let identityRepository: ReturnType<typeof createMockIdentityRepository>;
  let hashService: ReturnType<typeof createMockHashService>;
  let tokenIssuer: ReturnType<typeof createMockTokenIssuer>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    identityRepository = createMockIdentityRepository();
    hashService = createMockHashService();
    tokenIssuer = createMockTokenIssuer();
    logger = createMockLogger();
    useCase = new AuthenticateCustomerUseCase(identityRepository, hashService, tokenIssuer, logger);
  });

  it('should issue a token and log the success with the masked cpf', async () => {
    identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());
    hashService.compare.mockResolvedValue(true);

    const result = await useCase.execute({ cpf: FORMATTED_CPF, password: 'Senha@123' });

    expect(result).toEqual({
      accessToken: 'jwt.token.value',
      expiresIn: 3600,
    });
    expect(tokenIssuer.issueAccessToken).toHaveBeenCalledWith(SUBJECT_ID);
    expect(logger.eventNamed('auth.customer.authentication.succeeded')).toMatchObject({
      level: 'info',
      fields: { subjectId: SUBJECT_ID, maskedCpf: FORMATTED_CPF },
    });
  });

  it('should look the identity up by the normalized cpf', async () => {
    identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());
    hashService.compare.mockResolvedValue(true);

    await useCase.execute({ cpf: '123 456 789 09', password: 'Senha@123' });

    expect(identityRepository.findByCpf).toHaveBeenCalledWith(VALID_CPF);
  });

  it('should compare the password against the stored hash', async () => {
    identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());
    hashService.compare.mockResolvedValue(true);

    await useCase.execute({ cpf: VALID_CPF, password: 'Senha@123' });

    expect(hashService.compare).toHaveBeenCalledWith('Senha@123', STORED_HASH);
  });

  it('should not carry personal data in the output', async () => {
    identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());
    hashService.compare.mockResolvedValue(true);

    const result = await useCase.execute({ cpf: VALID_CPF, password: 'Senha@123' });

    expect(Object.keys(result).sort()).toEqual(['accessToken', 'expiresIn']);
    expect(JSON.stringify(result)).not.toContain(VALID_CPF);
    expect(JSON.stringify(result)).not.toContain(SUBJECT_ID);
  });

  describe('credential rejection', () => {
    /**
     * As quatro causas produzem a mesma exceção, com a mesma mensagem. A causa
     * específica existe apenas no log — nada na resposta pode revelar se um CPF
     * está cadastrado.
     */
    it.each([
      ['unknown_user', null, false],
      ['inactive_user', createMockCustomerUser({ isActive: false }), true],
      ['wrong_password', createMockCustomerUser(), false],
      ['no_active_customer_link', createMockCustomerUser({ hasActiveCustomerLink: false }), true],
    ])('should reject with %s', async (reason, user, passwordMatches) => {
      identityRepository.findByCpf.mockResolvedValue(user);
      hashService.compare.mockResolvedValue(passwordMatches);

      await expect(useCase.execute({ cpf: FORMATTED_CPF, password: 'x' })).rejects.toThrow(
        UnauthorizedAccessException,
      );

      expect(logger.eventNamed('auth.customer.authentication.failed')).toMatchObject({
        level: 'warn',
        fields: { failureReason: reason, maskedCpf: FORMATTED_CPF },
      });
    });

    it('should raise an indistinguishable exception for every cause', async () => {
      const raised: string[] = [];

      for (const [user, passwordMatches] of [
        [null, false],
        [createMockCustomerUser({ isActive: false }), true],
        [createMockCustomerUser(), false],
        [createMockCustomerUser({ hasActiveCustomerLink: false }), true],
      ] as const) {
        identityRepository.findByCpf.mockResolvedValue(user);
        hashService.compare.mockResolvedValue(passwordMatches);

        raised.push(
          await useCase.execute({ cpf: VALID_CPF, password: 'x' }).then(
            () => 'não deveria ter concedido',
            (error: Error) => `${error.name}:${error.message}`,
          ),
        );
      }

      expect(new Set(raised)).toEqual(
        new Set(['UnauthorizedAccessException:Credenciais inválidas']),
      );
    });

    it('should attach the subject only when the user exists', async () => {
      identityRepository.findByCpf.mockResolvedValue(null);

      await useCase.execute({ cpf: VALID_CPF, password: 'x' }).catch(() => undefined);

      expect(logger.events[0].fields).not.toHaveProperty('subjectId');
    });

    it('should emit exactly one business event per attempt', async () => {
      identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());
      hashService.compare.mockResolvedValue(false);

      await useCase.execute({ cpf: VALID_CPF, password: 'x' }).catch(() => undefined);

      expect(logger.events).toHaveLength(1);
    });
  });

  describe('invalid cpf', () => {
    it('should reject before touching the database and log the input rejection', async () => {
      await expect(useCase.execute({ cpf: '111.111.111-11', password: 'x' })).rejects.toThrow(
        DomainValidationException,
      );

      expect(identityRepository.findByCpf).not.toHaveBeenCalled();
      expect(hashService.compare).not.toHaveBeenCalled();
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
     * O `instanceof` no `catch` não é zelo: sem ele, uma falha alheia à
     * validação seria registrada como `invalid_cpf` e apontaria o diagnóstico
     * para o lado errado.
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
