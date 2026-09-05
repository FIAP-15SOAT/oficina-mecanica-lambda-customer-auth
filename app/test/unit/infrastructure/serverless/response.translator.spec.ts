import { BadRequestException } from '@application/exceptions/bad-request.exception';
import { UnauthorizedAccessException } from '@application/exceptions/unauthorized-access.exception';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { DatabaseOperationException } from '@infrastructure/exceptions/database-operation.exception';
import { TokenSigningException } from '@infrastructure/exceptions/token-signing.exception';
import {
  buildErrorResponse,
  buildSuccessResponse,
  inputRejectionMessage,
  INVALID_CREDENTIALS_MESSAGE,
  JSON_CONTENT_TYPE,
  SERVICE_UNAVAILABLE_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE,
} from '@infrastructure/serverless/response.translator';

function bodyOf(response: { body?: string }) {
  return JSON.parse(String(response.body)) as Record<string, unknown>;
}

describe('buildSuccessResponse', () => {
  it('should answer 200 with the data envelope', () => {
    const response = buildSuccessResponse({
      data: { accessToken: 'jwt', expiresIn: 3600 },
    });

    expect(response.statusCode).toBe(200);
    // `no-store` porque o corpo carrega um bearer token.
    expect(response.headers).toEqual({
      'content-type': JSON_CONTENT_TYPE,
      'cache-control': 'no-store',
    });
    expect(bodyOf(response)).toEqual({
      data: { accessToken: 'jwt', expiresIn: 3600 },
    });
  });
});

describe('buildErrorResponse', () => {
  it.each([
    [new DomainValidationException('CPF inválido'), 400, 'Bad Request', 'CPF inválido'],
    [
      new BadRequestException('Informe cpf e password'),
      400,
      'Bad Request',
      'Informe cpf e password',
    ],
    [new UnauthorizedAccessException(), 401, 'Unauthorized', INVALID_CREDENTIALS_MESSAGE],
    [
      new DatabaseOperationException('busca', { cause: new Error('timeout') }),
      503,
      'Service Unavailable',
      SERVICE_UNAVAILABLE_MESSAGE,
    ],
    [new TokenSigningException('kid'), 500, 'Internal Server Error', UNEXPECTED_ERROR_MESSAGE],
    [new Error('anything'), 500, 'Internal Server Error', UNEXPECTED_ERROR_MESSAGE],
    ['not even an error', 500, 'Internal Server Error', UNEXPECTED_ERROR_MESSAGE],
  ])('should map %p to %s', (error, statusCode, name, message) => {
    const response = buildErrorResponse(error);

    expect(response.statusCode).toBe(statusCode);
    expect(bodyOf(response)).toEqual({ statusCode, error: name, message });
  });

  it('should use the same error body shape the API uses', () => {
    expect(
      Object.keys(bodyOf(buildErrorResponse(new UnauthorizedAccessException()))).sort(),
    ).toEqual(['error', 'message', 'statusCode']);
  });

  /**
   * O detalhe do banco existe no log e não na resposta: endereço, porta, cadeia
   * de conexão e pilha de execução ficam do lado de dentro.
   */
  it('should not leak database detail on the unavailability response', () => {
    const rendered = String(
      buildErrorResponse(
        new DatabaseOperationException('busca', {
          cause: new Error(
            'connect ECONNREFUSED 10.0.3.17:5432 postgresql://oficina_ro:senha@db.internal/techchallenge',
          ),
        }),
      ).body,
    );

    expect(rendered).not.toContain('10.0.3.17');
    expect(rendered).not.toContain('5432');
    expect(rendered).not.toContain('postgresql://');
    expect(rendered).not.toContain('senha');
  });

  it('should not leak an internal message on the generic failure', () => {
    const rendered = String(buildErrorResponse(new Error('/var/task/src/handler.js:42')).body);

    expect(rendered).not.toContain('/var/task');
    expect(rendered).toContain(UNEXPECTED_ERROR_MESSAGE);
  });

  it('should answer 401 identically for every credential cause', () => {
    const rendered = new Set(
      ['unknown_user', 'inactive_user', 'wrong_password', 'no_active_customer_link'].map(() =>
        JSON.stringify(buildErrorResponse(new UnauthorizedAccessException())),
      ),
    );

    expect(rendered.size).toBe(1);
  });
});

describe('inputRejectionMessage', () => {
  it.each([
    'invalid_cpf',
    'missing_body',
    'malformed_body',
    'body_too_large',
    'invalid_credentials',
  ] as const)('should describe the shape of the problem for %s', (reason) => {
    const message = inputRejectionMessage(reason);

    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain('undefined');
  });
});
