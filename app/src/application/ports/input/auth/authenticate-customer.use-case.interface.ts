import {
  AuthenticateCustomerInputDto,
  AuthenticateCustomerOutputDto,
} from '@application/ports/input/auth/dto/authenticate-customer.dto';

export interface IAuthenticateCustomerUseCase {
  execute(input: AuthenticateCustomerInputDto): Promise<AuthenticateCustomerOutputDto>;
}
