import { randomUUID } from 'node:crypto';

import { sanitizeText } from './redaction/text-sanitizer';
import { runSafely } from './logging-diagnostics';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_ATTRIBUTE = 'request.id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveCorrelationId(
  headers: Record<string, string | undefined> | undefined,
  invocationId: string | undefined,
): string {
  return runSafely(
    'request-id',
    () => {
      const inbound =
        pickHeader(headers, REQUEST_ID_HEADER) ?? pickHeader(headers, CORRELATION_ID_HEADER);

      if (isReusable(inbound)) {
        return inbound;
      }

      return isReusable(invocationId) ? invocationId : randomUUID();
    },
    randomUUID(),
  );
}

function isReusable(candidate: string | undefined): candidate is string {
  if (!candidate || !REQUEST_ID_PATTERN.test(candidate)) {
    return false;
  }

  return sanitizeText(candidate) === candidate;
}

function pickHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);

  return match === undefined ? undefined : headers[match];
}
