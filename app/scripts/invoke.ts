import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

import { handler } from '../src/handler';

const DEFAULT_EVENT = 'events/login.event.json';

function buildContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'customer-auth-local',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:local:000000000000:function:customer-auth-local',
    memoryLimitInMB: '512',
    awsRequestId: randomUUID(),
    logGroupName: '/local/customer-auth',
    logStreamName: 'local',
    getRemainingTimeInMillis: () => 30_000,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}

async function invokeOnce(eventFile: string): Promise<void> {
  const event = JSON.parse(await readFile(eventFile, 'utf8')) as APIGatewayProxyEventV2;

  console.log(JSON.stringify(await handler(event, buildContext()), null, 2));
}

void invokeOnce(process.argv[2] ?? DEFAULT_EVENT).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
