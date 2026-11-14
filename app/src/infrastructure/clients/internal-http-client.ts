import axios, { isAxiosError } from 'axios';
import { Agent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { REQUEST_ID_HEADER } from '@infrastructure/logging/correlation';

const INTERNAL_HTTP_TIMEOUT_MS = 2_000;

const TRACEPARENT_HEADER = 'traceparent';

// The environment freezes between invocations and the owners close idle sockets, so a reused connection may already be dead.
const NO_KEEP_ALIVE_HTTP_AGENT = new Agent({ keepAlive: false });
const NO_KEEP_ALIVE_HTTPS_AGENT = new HttpsAgent({ keepAlive: false });

export interface InternalCallContext {
  requestId: string;
  traceparent: string;
}

export interface InternalRequest {
  method: 'GET' | 'POST';
  baseUrl: string;
  path: string;
  body?: unknown;
}

export class InternalHttpClient {
  constructor(private readonly callContext: InternalCallContext) {}

  async request<T>({ method, baseUrl, path, body }: InternalRequest): Promise<T> {
    try {
      const response = await axios.request<T>({
        baseURL: baseUrl,
        url: path,
        method,
        data: body,
        timeout: INTERNAL_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        httpAgent: NO_KEEP_ALIVE_HTTP_AGENT,
        httpsAgent: NO_KEEP_ALIVE_HTTPS_AGENT,
        headers: {
          [REQUEST_ID_HEADER]: this.callContext.requestId,
          [TRACEPARENT_HEADER]: this.callContext.traceparent,
        },
      });

      return response.data;
    } catch (error) {
      if (isAxiosError(error)) {
        throw new ServiceIntegrationException(`${method} ${path}`, error.response?.status, {
          cause: error,
        });
      }

      throw error;
    }
  }
}
