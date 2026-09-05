import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';

export interface SecretsGateway {
  getSecretValue(secretId: string): Promise<string>;
}

export type SecretsGatewayFactory = () => SecretsGateway;

export function createAwsSecretsGateway(): SecretsGateway {
  const client = new SecretsManagerClient({});

  return {
    async getSecretValue(secretId: string): Promise<string> {
      const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

      if (typeof response.SecretString !== 'string' || response.SecretString.length === 0) {
        throw new ConfigurationException(`Segredo ${secretId} não possui valor textual`);
      }

      return response.SecretString;
    },
  };
}
