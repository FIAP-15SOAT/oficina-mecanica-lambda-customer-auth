import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

export interface EventOverrides {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export function buildEvent(overrides: EventOverrides = {}): APIGatewayProxyEventV2 {
  const { method = 'POST', headers, body, isBase64Encoded = false } = overrides;

  return {
    version: '2.0',
    routeKey: 'POST /customer-auth/login',
    rawPath: '/customer-auth/login',
    rawQueryString: '',
    headers: headers ?? { 'content-type': 'application/json' },
    requestContext: {
      accountId: '000000000000',
      apiId: 'abc123',
      domainName: 'abc123.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'abc123',
      http: {
        method,
        path: '/customer-auth/login',
        protocol: 'HTTP/1.1',
        sourceIp: '203.0.113.10',
        userAgent: 'jest',
      },
      requestId: 'req-abc',
      routeKey: 'POST /customer-auth/login',
      stage: '$default',
      time: '31/Aug/2026:12:00:00 +0000',
      timeEpoch: 1787232000000,
    },
    body,
    isBase64Encoded,
  };
}

export function buildJsonEvent(
  payload: unknown,
  overrides: EventOverrides = {},
): APIGatewayProxyEventV2 {
  return buildEvent({ body: JSON.stringify(payload), ...overrides });
}

export function buildContext(overrides: Partial<Context> = {}): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'customer-auth',
    functionVersion: '7',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:customer-auth',
    memoryLimitInMB: '512',
    awsRequestId: '8f0c4b0e-1b7c-4a1a-9a0a-9b1e8c6d2f31',
    logGroupName: '/aws/lambda/customer-auth',
    logStreamName: '2026/08/31/[7]abcdef0123456789',
    getRemainingTimeInMillis: () => 30_000,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
    ...overrides,
  };
}
