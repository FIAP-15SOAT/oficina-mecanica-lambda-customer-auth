import axios, { AxiosError, AxiosResponse } from 'axios';
import { Agent } from 'node:http';

import {
  INTERNAL_HTTP_TIMEOUT_MS,
  InternalHttpClient,
} from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';

const CALL_CONTEXT = {
  requestId: 'req-123',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
};

const BASE_URL = 'http://internal-nlb.local:8081';
const PATH = '/internal/customer-authentications';

describe('InternalHttpClient', () => {
  let axiosRequest: jest.SpiedFunction<typeof axios.request>;
  let internalHttpClient: InternalHttpClient;

  beforeEach(() => {
    axiosRequest = jest.spyOn(axios, 'request');

    internalHttpClient = new InternalHttpClient(CALL_CONTEXT);
  });

  afterEach(() => {
    axiosRequest.mockRestore();
  });

  it('should send the call with the base url, the path, the body, the 2 s timeout and no redirect', async () => {
    axiosRequest.mockResolvedValue({ data: {} });

    await internalHttpClient.request({
      method: 'POST',
      baseUrl: BASE_URL,
      path: PATH,
      body: { cpf: '12345678909' },
    });

    expect(INTERNAL_HTTP_TIMEOUT_MS).toBe(2_000);
    expect(axiosRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: BASE_URL,
        url: PATH,
        method: 'POST',
        data: { cpf: '12345678909' },
        timeout: 2_000,
        maxRedirects: 0,
      }),
    );
  });

  it('should send the request id and the traceparent of the invocation', async () => {
    axiosRequest.mockResolvedValue({ data: {} });

    await internalHttpClient.request({ method: 'GET', baseUrl: BASE_URL, path: PATH });

    expect(axiosRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-request-id': 'req-123', traceparent: CALL_CONTEXT.traceparent },
      }),
    );
  });

  it('should open a new connection for each call', async () => {
    axiosRequest.mockResolvedValue({ data: {} });

    await internalHttpClient.request({ method: 'GET', baseUrl: BASE_URL, path: PATH });

    const [config] = axiosRequest.mock.calls[0];

    expect(config.httpAgent).toBeInstanceOf(Agent);
    expect(config.httpAgent).toMatchObject({ keepAlive: false });
  });

  it('should return the owner response data', async () => {
    axiosRequest.mockResolvedValue({ data: { data: { userId: 'user-1' } } });

    const result = await internalHttpClient.request({
      method: 'GET',
      baseUrl: BASE_URL,
      path: PATH,
    });

    expect(result).toEqual({ data: { userId: 'user-1' } });
  });

  it.each([401, 500])(
    'should throw ServiceIntegrationException carrying the status when the owner answers with an error status (%i)',
    async (status) => {
      const axiosError = new AxiosError('Request failed', undefined, undefined, undefined, {
        status,
      } as AxiosResponse);

      axiosRequest.mockRejectedValue(axiosError);

      const error = await internalHttpClient
        .request({ method: 'POST', baseUrl: BASE_URL, path: PATH })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceIntegrationException);
      expect(error).toMatchObject({
        statusCode: status,
        message: `Falha na chamada interna POST ${PATH} com status ${status}`,
        cause: axiosError,
      });
    },
  );

  it('should throw ServiceIntegrationException without status when the call gets no response', async () => {
    const axiosError = new AxiosError('timeout of 2000ms exceeded', AxiosError.ECONNABORTED);
    axiosRequest.mockRejectedValue(axiosError);

    const error = await internalHttpClient
      .request({ method: 'GET', baseUrl: BASE_URL, path: PATH })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceIntegrationException);
    expect(error).toMatchObject({
      statusCode: undefined,
      message: `Falha na chamada interna GET ${PATH}`,
      cause: axiosError,
    });
  });

  it('should rethrow an error that does not come from the call', async () => {
    const unexpected = new TypeError('unexpected');
    axiosRequest.mockRejectedValue(unexpected);

    await expect(
      internalHttpClient.request({ method: 'GET', baseUrl: BASE_URL, path: PATH }),
    ).rejects.toBe(unexpected);
  });
});
