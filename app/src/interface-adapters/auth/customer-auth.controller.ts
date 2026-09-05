import { IAuthenticateCustomerUseCase } from '@application/ports/input/auth/authenticate-customer.use-case.interface';

import { CustomerAuthPresenter } from './customer-auth.presenter';
import { CustomerLoginRequest } from './requests/customer-login.request';
import { CustomerAuthDataResponse } from './responses/customer-auth.response';

export class CustomerAuthController {
  constructor(private readonly authenticateUseCase: IAuthenticateCustomerUseCase) {}

  async login(input: CustomerLoginRequest): Promise<CustomerAuthDataResponse> {
    const result = await this.authenticateUseCase.execute(input);

    return CustomerAuthPresenter.toCustomerAuthDataResponse(result);
  }
}
