import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { HttpWorkOrderUserCustomersGateway } from '@infrastructure/gateways/work-order/http-work-order-user-customers-gateway';

import { readUserCustomersFixture } from '../../../../helpers/contract-fixtures';

const WORK_ORDER_INTERNAL_URL = 'http://internal-nlb.local:80';
const USER_ID = '8c2f4a6e-1b3d-4e5f-9a7b-0c1d2e3f4a5b';
const PATH = `/internal/users/${USER_ID}/customers`;

describe('HttpWorkOrderUserCustomersGateway', () => {
  let internalHttpClient: jest.Mocked<InternalHttpClient>;
  let gateway: HttpWorkOrderUserCustomersGateway;

  beforeEach(() => {
    internalHttpClient = { request: jest.fn() } as unknown as jest.Mocked<InternalHttpClient>;

    gateway = new HttpWorkOrderUserCustomersGateway(internalHttpClient, WORK_ORDER_INTERNAL_URL);
  });

  it('should return the active customers of the user', async () => {
    internalHttpClient.request.mockResolvedValue({ data: readUserCustomersFixture() });

    const result = await gateway.findActiveByUserId(USER_ID);

    expect(result).toEqual(readUserCustomersFixture());
  });

  it('should read the customers route of the user', async () => {
    internalHttpClient.request.mockResolvedValue({ data: readUserCustomersFixture() });

    await gateway.findActiveByUserId(USER_ID);

    expect(internalHttpClient.request).toHaveBeenCalledWith({
      method: 'GET',
      baseUrl: WORK_ORDER_INTERNAL_URL,
      path: PATH,
    });
  });

  it('should return an empty list when the user has no active customer', async () => {
    internalHttpClient.request.mockResolvedValue({ data: [] });

    const result = await gateway.findActiveByUserId(USER_ID);

    expect(result).toEqual([]);
  });

  it('should propagate a failure of the work order', async () => {
    const failure = new ServiceIntegrationException(`GET ${PATH}`, 500);

    internalHttpClient.request.mockRejectedValue(failure);

    await expect(gateway.findActiveByUserId(USER_ID)).rejects.toBe(failure);
  });

  it.each([{}, { data: null }, { data: { items: [], total: 0 } }, '<html></html>', null])(
    'should treat an answer without the customer list as an unavailability (%p)',
    async (answer) => {
      internalHttpClient.request.mockResolvedValue(answer);

      const error = await gateway.findActiveByUserId(USER_ID).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceIntegrationException);
      expect(error).toMatchObject({ message: `Falha na chamada interna GET ${PATH}` });
    },
  );
});
