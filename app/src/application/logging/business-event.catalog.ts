import { defineLogEvent } from './log-event';

export type AuthenticationFailureReason =
  'unknown_user' | 'inactive_user' | 'wrong_password' | 'no_active_customer_link';

export type InputRejectionReason =
  'invalid_cpf' | 'missing_body' | 'malformed_body' | 'body_too_large' | 'invalid_credentials';

export const BUSINESS_EVENTS = {
  AUTHENTICATION_SUCCEEDED: defineLogEvent<{ subjectId: string; maskedCpf: string }>({
    name: 'auth.customer.authentication.succeeded',
    message: 'customer credentials accepted and access token issued',
    level: 'info',
  }),
  AUTHENTICATION_FAILED: defineLogEvent<{
    failureReason: AuthenticationFailureReason;
    maskedCpf: string;
    subjectId?: string;
  }>({
    name: 'auth.customer.authentication.failed',
    message: 'customer credentials rejected',
    level: 'warn',
  }),
  AUTHENTICATION_INPUT_REJECTED: defineLogEvent<{
    failureReason: InputRejectionReason;
    maskedCpf?: string;
  }>({
    name: 'auth.customer.input.rejected',
    message: 'customer authentication request rejected before credential check',
    level: 'warn',
  }),
} as const;
