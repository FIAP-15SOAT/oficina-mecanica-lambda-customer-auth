import type { InvocationContext } from '@infrastructure/logging/execution-attributes';

const CONTEXT: InvocationContext = {
  awsRequestId: '8f0c4b0e-1b7c-4a1a-9a0a-9b1e8c6d2f31',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:customer-auth',
  functionName: 'customer-auth',
  functionVersion: '7',
  memoryLimitInMB: '512',
  logStreamName: '2026/08/31/[7]abcdef0123456789',
};

/**
 * The cold start flag is module state because that is what it describes: the
 * execution environment, loaded once and reused. Each test reloads the module
 * to get a fresh environment.
 */
function loadModule(): typeof import('@infrastructure/logging/execution-attributes') {
  let loaded!: typeof import('@infrastructure/logging/execution-attributes');

  jest.isolateModules(() => {
    loaded = jest.requireActual('@infrastructure/logging/execution-attributes');
  });

  return loaded;
}

describe('resolveExecutionAttributes', () => {
  it('should describe the invocation and the cloud resource', () => {
    const attributes = loadModule().resolveExecutionAttributes(CONTEXT, {
      AWS_REGION: 'us-east-1',
    });

    expect(attributes).toEqual({
      'faas.invocation_id': CONTEXT.awsRequestId,
      'faas.coldstart': true,
      'faas.name': 'customer-auth',
      'faas.version': '7',
      'faas.instance': CONTEXT.logStreamName,
      'faas.max_memory': 512 * 1024 * 1024,
      'cloud.provider': 'aws',
      'cloud.platform': 'aws_lambda',
      'cloud.region': 'us-east-1',
      'cloud.resource_id': CONTEXT.invokedFunctionArn,
    });
  });

  it('should mark the first invocation cold and the next one warm', () => {
    const { resolveExecutionAttributes } = loadModule();

    expect(resolveExecutionAttributes(CONTEXT, {})['faas.coldstart']).toBe(true);
    expect(resolveExecutionAttributes(CONTEXT, {})['faas.coldstart']).toBe(false);
  });

  it('should fall back to an empty region when the platform does not declare one', () => {
    expect(loadModule().resolveExecutionAttributes(CONTEXT, {})['cloud.region']).toBe('');
  });

  it('should report zero memory when the limit is not a number', () => {
    const attributes = loadModule().resolveExecutionAttributes(
      { ...CONTEXT, memoryLimitInMB: 'não-é-número' },
      {},
    );

    expect(attributes['faas.max_memory']).toBe(0);
  });
});
