import { LogLevelName } from '@application/logging/log-event';

import { describeError, resolveErrorMessage, resolveErrorType } from './error-serializer';
import { runSafely } from './logging-diagnostics';
import { sanitizeText } from './redaction/text-sanitizer';

export const INVOCATION_LOG_MESSAGE = 'http request';

export const DURATION_ATTRIBUTE = 'oficina.faas.invocation.duration_ms';
export const QUERY_DURATION_ATTRIBUTE = 'oficina.db.query.duration_ms';
export const PASSWORD_DURATION_ATTRIBUTE = 'oficina.auth.password.verification.duration_ms';

const SERVER_ERROR_STATUS = 500;

export interface InvocationOutcome {
  method: string;
  statusCode: number;
  durationMs: number;
  queryDurationMs?: number;
  passwordVerificationDurationMs?: number;
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
    ...optionalDuration(QUERY_DURATION_ATTRIBUTE, outcome.queryDurationMs),
    ...optionalDuration(PASSWORD_DURATION_ATTRIBUTE, outcome.passwordVerificationDurationMs),
    ...buildErrorAttributes(outcome),
  };
}

function optionalDuration(attribute: string, value: number | undefined): Record<string, number> {
  return typeof value === 'number' ? { [attribute]: value } : {};
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
