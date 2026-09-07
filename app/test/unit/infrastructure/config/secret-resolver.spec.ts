import { SecretsGateway } from '@infrastructure/config/aws-secrets.gateway';
import { createSecretResolver } from '@infrastructure/config/secret-resolver';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';

function createGateway(value = 'valor-do-segredo') {
  const gateway: SecretsGateway = { getSecretValue: jest.fn().mockResolvedValue(value) };
  const factory = jest.fn().mockReturnValue(gateway);

  return { gateway, factory };
}

describe('createSecretResolver', () => {
  /**
   * A propriedade que faz a função rodar localmente sem credencial de nuvem
   * alguma: com fallback presente, o cliente sequer é instanciado.
   */
  it('should not reach the cloud client when the fallback is present', async () => {
    const { gateway, factory } = createGateway();
    const resolver = createSecretResolver(factory);

    await expect(
      resolver.resolve({ secretId: 'oficina/db', fallback: 'senha-local' }),
    ).resolves.toBe('senha-local');

    expect(factory).not.toHaveBeenCalled();
    expect(gateway.getSecretValue).not.toHaveBeenCalled();
  });

  it('should fetch from the secrets manager when there is no fallback', async () => {
    const { gateway, factory } = createGateway('segredo-remoto');
    const resolver = createSecretResolver(factory);

    await expect(resolver.resolve({ secretId: 'oficina/db' })).resolves.toBe('segredo-remoto');

    expect(gateway.getSecretValue).toHaveBeenCalledWith('oficina/db');
  });

  it('should create the gateway once and reuse it across secrets', async () => {
    const { factory } = createGateway();
    const resolver = createSecretResolver(factory);

    await resolver.resolve({ secretId: 'oficina/db' });
    await resolver.resolve({ secretId: 'oficina/jwt' });

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should fail when neither an identifier nor a fallback is available', async () => {
    const { factory } = createGateway();
    const resolver = createSecretResolver(factory);

    await expect(resolver.resolve({})).rejects.toThrow(ConfigurationException);
    await expect(resolver.resolve({})).rejects.toThrow('sem identificador nem fallback');
    expect(factory).not.toHaveBeenCalled();
  });
});
