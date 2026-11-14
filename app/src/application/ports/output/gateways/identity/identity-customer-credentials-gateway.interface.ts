import { IdentityCustomerAuthenticationGatewayResponse } from './identity-customer-credentials-gateway.response';

export interface IIdentityCustomerCredentialsGateway {
  authenticate(
    cpf: string,
    password: string,
  ): Promise<IdentityCustomerAuthenticationGatewayResponse | null>;
}
