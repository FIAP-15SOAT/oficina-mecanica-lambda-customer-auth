import { InfrastructureException } from './infrastructure.exception';

export class ServiceIntegrationException extends InfrastructureException {
  constructor(
    operation: string,
    readonly statusCode?: number,
    options?: ErrorOptions,
  ) {
    super(
      statusCode === undefined
        ? `Falha na chamada interna ${operation}`
        : `Falha na chamada interna ${operation} com status ${statusCode}`,
      options,
    );
  }
}
