import { IIdentityCustomerCredentialsGateway } from '@application/ports/output/gateways/identity/identity-customer-credentials-gateway.interface';
import { IdentityCustomerAuthenticationGatewayResponse } from '@application/ports/output/gateways/identity/identity-customer-credentials-gateway.response';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';

const CREDENTIAL_REFUSED_STATUS = 401;

export class HttpIdentityCustomerCredentialsGateway implements IIdentityCustomerCredentialsGateway {
  constructor(
    private readonly internalHttpClient: InternalHttpClient,
    private readonly identityInternalUrl: string,
  ) {}

  async authenticate(
    cpf: string,
    password: string,
  ): Promise<IdentityCustomerAuthenticationGatewayResponse | null> {
    const path = '/internal/customer-authentications';

    try {
      const answer = await this.internalHttpClient.request<{
        data?: IdentityCustomerAuthenticationGatewayResponse;
      } | null>({
        method: 'POST',
        baseUrl: this.identityInternalUrl,
        path,
        body: { cpf, password },
      });

      const credential = answer?.data;

      // A success without the user id breaks the contract: refusing it as a wrong credential would hide the cause.
      if (typeof credential?.userId !== 'string') {
        throw new ServiceIntegrationException(`POST ${path}`);
      }

      return credential;
    } catch (error) {
      // Any other refusal means the two contracts drifted apart, so it stays an unavailability.
      if (
        error instanceof ServiceIntegrationException &&
        error.statusCode === CREDENTIAL_REFUSED_STATUS
      ) {
        return null;
      }

      throw error;
    }
  }
}
