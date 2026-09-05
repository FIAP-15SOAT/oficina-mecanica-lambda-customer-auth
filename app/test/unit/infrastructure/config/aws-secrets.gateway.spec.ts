import { createAwsSecretsGateway } from '@infrastructure/config/aws-secrets.gateway';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';

const send = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send })),
  GetSecretValueCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

describe('createAwsSecretsGateway', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('should return the textual value of the requested secret', async () => {
    send.mockResolvedValue({ SecretString: '{"username":"postgres"}' });

    const gateway = createAwsSecretsGateway();

    await expect(gateway.getSecretValue('oficina/db')).resolves.toBe('{"username":"postgres"}');
    expect(send).toHaveBeenCalledWith({ input: { SecretId: 'oficina/db' } });
  });

  it.each([[{}], [{ SecretString: '' }], [{ SecretBinary: new Uint8Array() }]])(
    'should reject a secret without a textual value (%p)',
    async (response) => {
      send.mockResolvedValue(response);

      const gateway = createAwsSecretsGateway();

      await expect(gateway.getSecretValue('oficina/db')).rejects.toThrow(ConfigurationException);
    },
  );
});
