import { defineLogEvent } from '@application/logging/log-event';

type EmptyFields = Record<never, never>;

export const TECHNICAL_EVENTS = {
  INTERNAL_CALL_FAILED: defineLogEvent<EmptyFields>({
    name: 'internal.call.failed',
    message: 'internal service call failed',
    level: 'error',
  }),
  TOKEN_SIGNING_FAILED: defineLogEvent<EmptyFields>({
    name: 'auth.customer.token.signing.failed',
    message: 'access token could not be signed',
    level: 'error',
  }),
  CONFIGURATION_INVALID: defineLogEvent<EmptyFields>({
    name: 'app.configuration.invalid',
    message: 'execution environment could not be initialized',
    level: 'error',
  }),
  INITIALIZATION_FAILED: defineLogEvent<EmptyFields>({
    name: 'app.initialization.failed',
    message: 'execution environment dependencies could not be initialized',
    level: 'error',
  }),
} as const;
