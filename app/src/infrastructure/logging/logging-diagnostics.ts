import { resolveLoggerConfig } from './logger.config';

/**
 * Um evento `'error'` sem listener em stream do Node derruba o processo, e o
 * `stderr` aceita a escrita e emite o erro depois, de forma assíncrona — fora
 * do alcance do `try/catch` do escritor abaixo.
 */
process.stderr.on('error', () => undefined);

export type LoggingFailureStage =
  | 'config'
  | 'sanitization'
  | 'serialization'
  | 'emit'
  | 'invocation-log'
  | 'request-id'
  | 'bootstrap'
  | 'destination';

export const DESTINATION_FAILURE_POLICY = 'continue-degraded';

export interface LoggingFailureDetail {
  field?: string;
  errorType?: string;
}

let destinationFailureReported = false;

/**
 * Canal de diagnóstico do próprio logger, e por isso escreve direto em `stderr`
 * (fd 2) em vez de usar o `ILogger`: reportar a falha pelo mesmo caminho que
 * acabou de quebrar arrisca recursão, e quando o que falhou é o destino — o
 * `stdout` — logar lá é garantir silêncio.
 *
 * O detalhe carrega apenas o nome do campo e o tipo do erro. Nunca o valor:
 * esta linha não pode virar a via de vazamento que a redação existe para evitar.
 */
export function reportLoggingFailure(
  stage: LoggingFailureStage,
  detail: LoggingFailureDetail = {},
): void {
  writeDiagnostic({
    'oficina.logging.failure.stage': stage,
    ...(detail.field ? { 'oficina.logging.failure.field': detail.field } : {}),
    ...(detail.errorType ? { 'oficina.logging.failure.error_type': detail.errorType } : {}),
  });
}

export function reportDestinationFailure(): void {
  if (destinationFailureReported) {
    return;
  }

  destinationFailureReported = true;

  writeDiagnostic({
    'oficina.logging.failure.stage': 'destination',
    'oficina.logging.failure.policy': DESTINATION_FAILURE_POLICY,
  });
}

function writeDiagnostic(attributes: Record<string, string>): void {
  try {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'logging failure',
        ...resolveLoggerConfig().resource,
        ...attributes,
      })}\n`,
    );
  } catch {
    return;
  }
}

export function runSafely<T>(stage: LoggingFailureStage, operation: () => T, fallback: T): T {
  try {
    return operation();
  } catch (error) {
    reportLoggingFailure(stage, { errorType: resolveErrorTypeName(error) });

    return fallback;
  }
}

export function runSafelyVoid(stage: LoggingFailureStage, operation: () => void): void {
  try {
    operation();
  } catch (error) {
    reportLoggingFailure(stage, { errorType: resolveErrorTypeName(error) });
  }
}

function resolveErrorTypeName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
