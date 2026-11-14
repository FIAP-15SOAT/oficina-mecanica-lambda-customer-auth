import { LogLevelName } from '@application/logging/log-event';

import { describeError, resolveErrorMessage, resolveErrorType } from './error-serializer';
import { runSafely } from './logging-diagnostics';
import { sanitizeText } from './redaction/text-sanitizer';

export const INVOCATION_LOG_MESSAGE = 'http request';

export const DURATION_ATTRIBUTE = 'oficina.faas.invocation.duration_ms';

const SERVER_ERROR_STATUS = 500;

export interface InvocationOutcome {
  method: string;
  statusCode: number;
  durationMs: number;
  error?: unknown;
}

export interface InvocationLogLine {
  level: LogLevelName;
  message: string;
  record: Record<string, unknown>;
}

export function resolveInvocationLogLevel(statusCode: number): LogLevelName {
  if (statusCode >= SERVER_ERROR_STATUS) {
    return 'error';
  }

  if (statusCode >= 400) {
    return 'warn';
  }

  return 'info';
}

export function buildInvocationLogLine(outcome: InvocationOutcome): InvocationLogLine {
  return {
    level: resolveInvocationLogLevel(outcome.statusCode),
    message: INVOCATION_LOG_MESSAGE,
    record: runSafely('invocation-log', () => buildRecord(outcome), {}),
  };
}

function buildRecord(outcome: InvocationOutcome): Record<string, unknown> {
  return {
    'http.request.method': outcome.method,
    'http.response.status_code': outcome.statusCode,
    [DURATION_ATTRIBUTE]: outcome.durationMs,
    ...buildErrorAttributes(outcome),
  };
}

function buildErrorAttributes(outcome: InvocationOutcome): Record<string, unknown> {
  if (outcome.error === undefined) {
    return {};
  }

  if (outcome.statusCode >= SERVER_ERROR_STATUS) {
    return {
      'error.type': resolveErrorType(outcome.error),
      ...describeError(outcome.error),
    };
  }

  return {
    'error.type': resolveErrorType(outcome.error),
    'oficina.error.message': sanitizeText(resolveErrorMessage(outcome.error)),
  };
}
