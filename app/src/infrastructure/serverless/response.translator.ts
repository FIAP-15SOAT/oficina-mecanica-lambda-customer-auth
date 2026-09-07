import { InputRejectionReason } from '@application/logging/business-event.catalog';
import { LogEventDefinition } from '@application/logging/log-event';
import { BadRequestException } from '@application/exceptions/bad-request.exception';
import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { DatabaseOperationException } from '@infrastructure/exceptions/database-operation.exception';
import { TokenSigningException } from '@infrastructure/exceptions/token-signing.exception';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';
import { CustomerAuthDataResponse } from '@interface-adapters/auth/responses/customer-auth.response';

import { HandlerResponse } from './platform-types';

export const JSON_CONTENT_TYPE = 'application/json';

export const INVALID_CREDENTIALS_MESSAGE = 'Credenciais inválidas';
export const SERVICE_UNAVAILABLE_MESSAGE = 'Serviço temporariamente indisponível';
export const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error occurred';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
}

/**
 * Mensagem pública de cada recusa de entrada. Descreve a **forma** do problema
 * e nunca o conteúdo enviado: repetir o corpo de volta é o caminho clássico
 * para transformar uma resposta de erro em espelho de payload.
 */
const INPUT_REJECTION_MESSAGES: Readonly<Record<InputRejectionReason, string>> = {
  invalid_cpf: 'CPF inválido',
  missing_body: 'Corpo da requisição ausente',
  malformed_body: 'Corpo da requisição não é um JSON de objeto válido',
  body_too_large: 'Corpo da requisição excede o tamanho aceito',
  invalid_credentials: 'Informe cpf e password como texto',
};

export function inputRejectionMessage(reason: InputRejectionReason): string {
  return INPUT_REJECTION_MESSAGES[reason];
}

const ERROR_MAPPINGS: readonly {
  matches: (error: unknown) => boolean;
  statusCode: number;
  error: string;
  message: (error: Error) => string;
  event?: LogEventDefinition;
}[] = [
  {
    matches: (error) => error instanceof DomainValidationException,
    statusCode: 400,
    error: 'Bad Request',
    message: (error) => error.message,
  },
  {
    matches: (error) => error instanceof BadRequestException,
    statusCode: 400,
    error: 'Bad Request',
    message: (error) => error.message,
  },
  {
    matches: (error) => error instanceof UnauthorizedAccessException,
    statusCode: 401,
    error: 'Unauthorized',
    message: () => INVALID_CREDENTIALS_MESSAGE,
  },
  {
    matches: (error) => error instanceof DatabaseOperationException,
    statusCode: 503,
    error: 'Service Unavailable',
    message: () => SERVICE_UNAVAILABLE_MESSAGE,
    event: TECHNICAL_EVENTS.DATABASE_QUERY_FAILED,
  },
  {
    matches: (error) => error instanceof TokenSigningException,
    statusCode: 500,
    error: 'Internal Server Error',
    message: () => UNEXPECTED_ERROR_MESSAGE,
    event: TECHNICAL_EVENTS.TOKEN_SIGNING_FAILED,
  },
];

export function buildSuccessResponse(payload: CustomerAuthDataResponse): HandlerResponse {
  return {
    statusCode: 200,
    headers: { 'content-type': JSON_CONTENT_TYPE, 'cache-control': 'no-store' },
    body: JSON.stringify(payload),
  };
}

export function buildErrorResponse(error: unknown): HandlerResponse {
  const mapping = ERROR_MAPPINGS.find((candidate) => candidate.matches(error));

  const body: ErrorBody = mapping
    ? {
        statusCode: mapping.statusCode,
        error: mapping.error,
        message: mapping.message(error as Error),
      }
    : {
        statusCode: 500,
        error: 'Internal Server Error',
        message: UNEXPECTED_ERROR_MESSAGE,
      };

  return {
    statusCode: body.statusCode,
    headers: { 'content-type': JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
  };
}

export function resolveTechnicalEvent(error: unknown): LogEventDefinition | undefined {
  return ERROR_MAPPINGS.find((candidate) => candidate.matches(error))?.event;
}
