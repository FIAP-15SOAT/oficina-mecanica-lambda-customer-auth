import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { HttpIdentityCustomerCredentialsGateway } from '@infrastructure/gateways/identity/http-identity-customer-credentials-gateway';

import { readCustomerAuthenticationFixture } from '../../../../helpers/contract-fixtures';

const IDENTITY_INTERNAL_URL = 'http://internal-nlb.local:8081';
const PATH = '/internal/customer-authentications';
const CPF = '12345678909';
const PASSWORD = 'secret-password';

describe('HttpIdentityCustomerCredentialsGateway', () => {
  let internalHttpClient: jest.Mocked<InternalHttpClient>;
  let gateway: HttpIdentityCustomerCredentialsGateway;

  beforeEach(() => {
    internalHttpClient = { request: jest.fn() } as unknown as jest.Mocked<InternalHttpClient>;

    gateway = new HttpIdentityCustomerCredentialsGateway(internalHttpClient, IDENTITY_INTERNAL_URL);
  });

  it('should return the user id the identity accepted', async () => {
    internalHttpClient.request.mockResolvedValue({ data: readCustomerAuthenticationFixture() });

    const result = await gateway.authenticate(CPF, PASSWORD);

    expect(result).toEqual(readCustomerAuthenticationFixture());
  });

  it('should post the cpf and the password to the customer authentications route', async () => {
    internalHttpClient.request.mockResolvedValue({ data: readCustomerAuthenticationFixture() });

    await gateway.authenticate(CPF, PASSWORD);

    expect(internalHttpClient.request).toHaveBeenCalledWith({
      method: 'POST',
      baseUrl: IDENTITY_INTERNAL_URL,
      path: PATH,
      body: { cpf: CPF, password: PASSWORD },
    });
  });

  it('should return null when the identity refuses the credential', async () => {
    internalHttpClient.request.mockRejectedValue(
      new ServiceIntegrationException(`POST ${PATH}`, 401),
    );

    const result = await gateway.authenticate(CPF, PASSWORD);

    expect(result).toBeNull();
  });

  it.each([400, undefined])('should propagate any other failure (status %s)', async (status) => {
    const failure = new ServiceIntegrationException(`POST ${PATH}`, status);

    internalHttpClient.request.mockRejectedValue(failure);

    await expect(gateway.authenticate(CPF, PASSWORD)).rejects.toBe(failure);
  });

  it.each([{}, { data: {} }, { data: { userId: 42 } }, '<html></html>', null])(
    'should treat an answer without the user id as an unavailability (%p)',
    async (answer) => {
      internalHttpClient.request.mockResolvedValue(answer);

      const error = await gateway.authenticate(CPF, PASSWORD).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceIntegrationException);
      expect(error).toMatchObject({ message: `Falha na chamada interna POST ${PATH}` });
    },
  );
});
