import { AuthenticateCustomerOutputDto } from '@application/ports/input/auth/dto/authenticate-customer.dto';

import { CustomerAuthDataResponse } from './responses/customer-auth.response';

export class CustomerAuthPresenter {
  static toCustomerAuthDataResponse(
    result: AuthenticateCustomerOutputDto,
  ): CustomerAuthDataResponse {
    return {
      data: {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      },
    };
  }
}
