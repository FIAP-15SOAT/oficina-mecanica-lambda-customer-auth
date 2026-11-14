import { AuthenticateCustomerOutputDto } from '@application/ports/input/auth/dto/authenticate-customer.dto';
import { CustomerAuthPresenter } from '@interface-adapters/auth/customer-auth.presenter';

import { SUBJECT_ID, VALID_CPF } from '../../helpers/auth-mock.factory';

const OUTPUT: AuthenticateCustomerOutputDto = {
  accessToken: 'header.payload.signature',
  expiresIn: 3600,
};

describe('CustomerAuthPresenter', () => {
  it('should wrap the result in the data envelope the API adopts', () => {
    expect(CustomerAuthPresenter.toCustomerAuthDataResponse(OUTPUT)).toEqual({
      data: { accessToken: 'header.payload.signature', expiresIn: 3600 },
    });
  });

  it('should expose exactly the three contracted fields', () => {
    const { data } = CustomerAuthPresenter.toCustomerAuthDataResponse(OUTPUT);

    expect(Object.keys(data).sort()).toEqual(['accessToken', 'expiresIn']);
  });

  /**
   * The translation is field by field. A new field in the use case output is not
   * published in the response by itself — that is the path through which personal
   * data would leak.
   */
  it('should not let an extra field of the use case output reach the response', () => {
    const contaminated = {
      ...OUTPUT,
      cpf: VALID_CPF,
      email: 'maria@exemplo.com',
      customerId: SUBJECT_ID,
    } as AuthenticateCustomerOutputDto;

    const rendered = JSON.stringify(CustomerAuthPresenter.toCustomerAuthDataResponse(contaminated));

    expect(rendered).not.toContain(VALID_CPF);
    expect(rendered).not.toContain('maria@exemplo.com');
    expect(rendered).not.toContain(SUBJECT_ID);
  });
});
