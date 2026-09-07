import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';

import {
  createAwsSecretsGateway,
  SecretsGateway,
  SecretsGatewayFactory,
} from './aws-secrets.gateway';

export interface SecretRequest {
  secretId?: string;
  fallback?: string;
}

export interface SecretResolver {
  resolve(request: SecretRequest): Promise<string>;
}

export function createSecretResolver(
  factory: SecretsGatewayFactory = createAwsSecretsGateway,
): SecretResolver {
  let gateway: SecretsGateway | undefined;

  return {
    async resolve({ secretId, fallback }: SecretRequest): Promise<string> {
      if (fallback) {
        return fallback;
      }

      if (!secretId) {
        throw new ConfigurationException('Segredo sem identificador nem fallback');
      }

      gateway ??= factory();

      return gateway.getSecretValue(secretId);
    },
  };
}
