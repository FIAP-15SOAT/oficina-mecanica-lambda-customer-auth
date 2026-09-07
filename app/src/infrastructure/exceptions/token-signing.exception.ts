import { InfrastructureException } from './infrastructure.exception';

export class TokenSigningException extends InfrastructureException {
  constructor(detail?: string, options?: ErrorOptions) {
    super(detail ? `Falha ao assinar o token: ${detail}` : 'Falha ao assinar o token', options);
  }
}
