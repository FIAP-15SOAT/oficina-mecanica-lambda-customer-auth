import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

import { closeDependencies } from '../src/bootstrap';
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

  // O pool nunca se encerra sozinho: `allowExitOnIdle: false` mantém a conexão
  // referenciada. Isso é o certo na plataforma, que congela e reaproveita o
  // ambiente, e o errado aqui, onde o processo precisa terminar — sem isto,
  // toda invocação que alcança o banco deixa o comando pendurado.
  await closeDependencies();
}

void invokeOnce(process.argv[2] ?? DEFAULT_EVENT).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
