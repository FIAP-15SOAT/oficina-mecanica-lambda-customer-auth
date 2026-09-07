import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';

import { InputRejectionReason } from '@application/logging/business-event.catalog';
import { CustomerLoginRequest } from '@interface-adapters/auth/requests/customer-login.request';

export const MAX_BODY_BYTES = 4096;

const loginSchema = z.object({
  cpf: z.string().min(1),
  password: z.string().min(1),
});

export type LoginEventValidation =
  { ok: true; request: CustomerLoginRequest } | { ok: false; reason: InputRejectionReason };

export function validateLoginEvent(event: APIGatewayProxyEventV2): LoginEventValidation {
  const raw = event.isBase64Encoded && event.body ? decodeBase64(event.body) : event.body;

  if (!raw) {
    return { ok: false, reason: 'missing_body' };
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, reason: 'body_too_large' };
  }

  const parsed = parseJson(raw);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'malformed_body' };
  }

  const result = loginSchema.safeParse(parsed);

  return result.success
    ? { ok: true, request: result.data }
    : { ok: false, reason: 'invalid_credentials' };
}

function decodeBase64(body: string): string {
  return Buffer.from(body, 'base64').toString('utf8');
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
