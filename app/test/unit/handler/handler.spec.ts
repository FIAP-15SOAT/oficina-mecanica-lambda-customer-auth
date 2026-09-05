import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { getBaseLogger, getDependencies } from '../../../src/bootstrap';
import { handler, warmUp } from '../../../src/handler';
import { DatabaseOperationException } from '@infrastructure/exceptions/database-operation.exception';
import { TokenSigningException } from '@infrastructure/exceptions/token-signing.exception';

import {
  createMockCustomerUser,
  FORMATTED_CPF,
  SUBJECT_ID,
  VALID_CPF,
} from '../../helpers/auth-mock.factory';
import { createMockDependencies, MockDependencies } from '../../helpers/dependencies-mock.factory';
import { buildContext, buildEvent, buildJsonEvent } from '../../helpers/platform-event.factory';

jest.mock('../../../src/bootstrap', () => ({
  getDependencies: jest.fn(),
  getBaseLogger: jest.fn(),
}));

const dependenciesMock = getDependencies as jest.MockedFunction<typeof getDependencies>;
const baseLoggerMock = getBaseLogger as jest.MockedFunction<typeof getBaseLogger>;
const CREDENTIAL = { cpf: FORMATTED_CPF, password: 'Senha@123' };

function bodyOf(response: { body?: string }) {
  return JSON.parse(String(response.body)) as Record<string, unknown>;
}

/**
 * O aquecimento existe para que a primeira credencial real nao pague segredos,
 * PEM e handshake. Fora da plataforma ele nao age: um efeito de importacao
 * surpreenderia teste e script.
 */
describe('warmUp', () => {
  const original = process.env.AWS_LAMBDA_FUNCTION_NAME;

  beforeEach(() => {
    dependenciesMock.mockReset();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    } else {
      process.env.AWS_LAMBDA_FUNCTION_NAME = original;
    }
  });

  it('should start the composition when running on the platform', () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'customer-auth';

    warmUp();

    expect(dependenciesMock).toHaveBeenCalledTimes(1);
  });

  it('should stay inert outside the platform', () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;

    warmUp();

    expect(dependenciesMock).not.toHaveBeenCalled();
  });

  it('should swallow a composition failure instead of leaving it unhandled', async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'customer-auth';
    dependenciesMock.mockRejectedValue(new Error('secrets manager indisponivel'));

    expect(() => warmUp()).not.toThrow();

    await Promise.resolve();
  });
});

describe('handler', () => {
  let mocks: MockDependencies;

  beforeEach(() => {
    mocks = createMockDependencies();
    dependenciesMock.mockResolvedValue(mocks.dependencies);
    baseLoggerMock.mockReturnValue(mocks.capture.adapter);
  });

  describe('success path', () => {
    beforeEach(() => {
      mocks.identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());
      mocks.hashService.compare.mockResolvedValue(true);
    });

    it('should answer 200 with the token envelope', async () => {
      const response = await handler(buildJsonEvent(CREDENTIAL), buildContext());

      expect(response.statusCode).toBe(200);
      expect(bodyOf(response)).toEqual({
        data: { accessToken: 'jwt.token.value', expiresIn: 3600 },
      });
    });

    /** O corpo carrega um bearer token: nenhum intermediário deve retê-lo. */
    it('should forbid caching the response that carries the token', async () => {
      const response = await handler(buildJsonEvent(CREDENTIAL), buildContext());

      expect(response.headers).toMatchObject({ 'cache-control': 'no-store' });
    });

    it('should not carry personal data in the success body', async () => {
      const response = await handler(buildJsonEvent(CREDENTIAL), buildContext());

      expect(String(response.body)).not.toContain(VALID_CPF);
      expect(String(response.body)).not.toContain(SUBJECT_ID);
    });
  });

  describe('error paths', () => {
    it.each([
      ['a missing body', buildEvent({})],
      ['invalid json', buildEvent({ body: '{' })],
      ['a missing field', buildJsonEvent({ cpf: VALID_CPF })],
      ['a field with the wrong type', buildJsonEvent({ cpf: VALID_CPF, password: 42 })],
      ['an invalid cpf', buildJsonEvent({ cpf: '111.111.111-11', password: 'x' })],
      ['a body above the limit', buildJsonEvent({ cpf: VALID_CPF, password: 'x'.repeat(5000) })],
    ])('should answer 400 for %s', async (_case, event) => {
      expect((await handler(event, buildContext())).statusCode).toBe(400);
    });

    it('should decode a base64 encoded body', async () => {
      mocks.identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());
      mocks.hashService.compare.mockResolvedValue(true);

      const event = buildEvent({
        body: Buffer.from(JSON.stringify(CREDENTIAL)).toString('base64'),
        isBase64Encoded: true,
      });

      expect((await handler(event, buildContext())).statusCode).toBe(200);
    });

    /**
     * A montagem da linha de atendimento não pode alterar a resposta — a spec
     * de logging proíbe. Um evento sem `requestContext` chegava aqui com a
     * resposta já construída e derrubava a invocação com um `TypeError`,
     * entregando erro de plataforma no lugar do envelope documentado.
     */
    it('should answer normally when the event carries no requestContext', async () => {
      mocks.identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());
      mocks.hashService.compare.mockResolvedValue(true);

      const { requestContext: _absent, ...event } = buildJsonEvent(CREDENTIAL);

      const response = await handler(event as APIGatewayProxyEventV2, buildContext());

      expect(response.statusCode).toBe(200);
      expect(bodyOf(response)).toEqual({
        data: { accessToken: 'jwt.token.value', expiresIn: 3600 },
      });
    });

    it('should answer 401 for a rejected credential', async () => {
      mocks.identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());

      const response = await handler(buildJsonEvent(CREDENTIAL), buildContext());

      expect(response.statusCode).toBe(401);
      expect(bodyOf(response)).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Credenciais inválidas',
      });
    });

    it('should answer 503 when the database is unavailable', async () => {
      mocks.identityRepository.findByCpf.mockRejectedValue(
        new DatabaseOperationException('busca', { cause: new Error('timeout') }),
      );

      expect((await handler(buildJsonEvent(CREDENTIAL), buildContext())).statusCode).toBe(503);
    });

    it('should answer 500 when the token cannot be signed', async () => {
      mocks.identityRepository.findByCpf.mockResolvedValue(createMockCustomerUser());
      mocks.hashService.compare.mockResolvedValue(true);
      mocks.tokenIssuer.issueAccessToken.mockRejectedValue(new TokenSigningException('kid'));

      expect((await handler(buildJsonEvent(CREDENTIAL), buildContext())).statusCode).toBe(500);
    });

    it('should answer 500 for an unforeseen failure', async () => {
      mocks.identityRepository.findByCpf.mockRejectedValue(new RangeError('inesperado'));

      const response = await handler(buildJsonEvent(CREDENTIAL), buildContext());

      expect(response.statusCode).toBe(500);
      expect(bodyOf(response).message).toBe('An unexpected error occurred');
    });

    /**
     * A composição acontece na primeira invocação. Se ela falhar, o cliente
     * precisa receber o envelope documentado — deixar a exceção escapar entrega
     * um erro de plataforma, que não está no contrato.
     */
    it('should answer with the documented envelope when the composition fails', async () => {
      dependenciesMock.mockRejectedValue(new Error('secrets manager indisponível'));

      const response = await handler(buildJsonEvent(CREDENTIAL), buildContext());

      expect(response.statusCode).toBe(500);
      expect(bodyOf(response)).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
      expect(String(response.body)).not.toContain('secrets manager');
    });
  });
});
