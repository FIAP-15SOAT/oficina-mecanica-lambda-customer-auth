import { InfrastructureException } from './infrastructure.exception';

export class DatabaseOperationException extends InfrastructureException {
  constructor(operation: string, options?: ErrorOptions) {
    super(`Erro na operação ${operation}`, options);
  }
}
