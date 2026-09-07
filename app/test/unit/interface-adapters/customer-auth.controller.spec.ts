import { IAuthenticateCustomerUseCase } from '@application/ports/input/auth/authenticate-customer.use-case.interface';
import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';
import { CustomerAuthController } from '@interface-adapters/auth/customer-auth.controller';

import { VALID_CPF } from '../../helpers/auth-mock.factory';

function createUseCase(): jest.Mocked<IAuthenticateCustomerUseCase> {
  return {
    execute: jest.fn().mockResolvedValue({
      accessToken: 'header.payload.signature',
      expiresIn: 3600,
    }),
  };
}

describe('CustomerAuthController', () => {
  it('should orchestrate the use case and the presenter', async () => {
    const useCase = createUseCase();

    const response = await new CustomerAuthController(useCase).login({
      cpf: VALID_CPF,
      password: 'Senha@123',
    });

    expect(useCase.execute).toHaveBeenCalledWith({ cpf: VALID_CPF, password: 'Senha@123' });
    expect(response).toEqual({
      data: { accessToken: 'header.payload.signature', expiresIn: 3600 },
    });
  });

  it('should let the use case rejection through untouched', async () => {
    const useCase = createUseCase();
    useCase.execute.mockRejectedValue(new UnauthorizedAccessException());

    await expect(
      new CustomerAuthController(useCase).login({ cpf: VALID_CPF, password: 'x' }),
    ).rejects.toThrow(UnauthorizedAccessException);
  });
});
