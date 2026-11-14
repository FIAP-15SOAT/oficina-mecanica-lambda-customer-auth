import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { getBaseLogger, getDependencies } from '../../../src/bootstrap';
import { handler } from '../../../src/handler';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { TokenSigningException } from '@infrastructure/exceptions/token-signing.exception';
import { DECLARED_FIELD_NAMES } from '@infrastructure/logging/field-registry';

import { FORMATTED_CPF, VALID_CPF } from '../../helpers/auth-mock.factory';
import {
  readCustomerAuthenticationFixture,
  readUserCustomersFixture,
} from '../../helpers/contract-fixtures';
import { createMockDependencies, MockDependencies } from '../../helpers/dependencies-mock.factory';
import { buildContext, buildEvent, buildJsonEvent } from '../../helpers/platform-event.factory';

jest.mock('../../../src/bootstrap', () => ({
  getDependencies: jest.fn(),
  getBaseLogger: jest.fn(),
}));

const dependenciesMock = getDependencies as jest.MockedFunction<typeof getDependencies>;
const baseLoggerMock = getBaseLogger as jest.MockedFunction<typeof getBaseLogger>;
const CREDENTIAL = { cpf: FORMATTED_CPF, password: 'Senha@123' };

describe('handler — invocation log', () => {
  let mocks: MockDependencies;

  beforeEach(() => {
    mocks = createMockDependencies();
    dependenciesMock.mockResolvedValue(mocks.dependencies);
    baseLoggerMock.mockReturnValue(mocks.capture.adapter);
  });

  function grantAccess(): void {
    mocks.identityCustomerCredentialsGateway.authenticate.mockResolvedValue(
      readCustomerAuthenticationFixture(),
    );
    mocks.workOrderUserCustomersGateway.findActiveByUserId.mockResolvedValue(
      readUserCustomersFixture(),
    );
  }

  function sentTraceId(): string {
    const [, callContext] = mocks.dependencies.createController.mock.calls[0];

    return callContext.traceparent.split('-')[1];
  }

  function invocationLine() {
    return mocks.capture.lines().find((line) => line.message === 'http request');
  }

  it('should emit at most two lines per invocation', async () => {
    grantAccess();

    await handler(buildJsonEvent(CREDENTIAL), buildContext());

    expect(mocks.capture.lines()).toHaveLength(2);
    expect(mocks.capture.lines().filter((line) => line.message === 'http request')).toHaveLength(1);
  });

  /**
   * Uma falha de composição também é um atendimento: sem esta linha o 500 de
   * cold start sairia sem correlação e sem duração, fora de qualquer consulta
   * por request id ou SLI.
   */
  it('should still emit the invocation line when the composition fails', async () => {
    dependenciesMock.mockRejectedValue(new Error('secrets manager indisponível'));
    const context = buildContext();

    const response = await handler(buildJsonEvent(CREDENTIAL), context);

    expect(response.statusCode).toBe(500);

    const line = invocationLine();

    expect(line).toBeDefined();
    expect(line?.level).toBe('error');
    expect(line?.['request.id']).toBe(context.awsRequestId);
    expect(line?.['faas.invocation_id']).toBe(context.awsRequestId);
    expect(line?.['http.response.status_code']).toBe(500);
    expect(line?.['oficina.faas.invocation.duration_ms']).toEqual(expect.any(Number));
  });

  it.each([
    ['info', 200],
    ['warn', 401],
    ['error', 503],
  ])('should derive the level %s from the response status', async (level, statusCode) => {
    if (statusCode === 200) {
      grantAccess();
    } else if (statusCode === 503) {
      mocks.identityCustomerCredentialsGateway.authenticate.mockRejectedValue(
        new ServiceIntegrationException('POST /internal/customer-authentications'),
      );
    }

    await handler(buildJsonEvent(CREDENTIAL), buildContext());

    expect(invocationLine()?.level).toBe(level);
  });

  it('should still emit the invocation line when the event carries no requestContext', async () => {
    grantAccess();

    const { requestContext: _absent, ...event } = buildJsonEvent(CREDENTIAL);

    await handler(event as APIGatewayProxyEventV2, buildContext());

    expect(invocationLine()?.['http.response.status_code']).toBe(200);
    expect(invocationLine()?.['http.request.method']).toBe('');
  });

  /**
   * Um PEM ilegível já é registrado por `bootstrap` como configuração inválida.
   * Reclassificá-lo aqui como falha de assinatura anunciaria a mesma causa duas
   * vezes, com nomes contraditórios, apontando o diagnóstico para o runtime em
   * vez da implantação — e a cada invocação, já que a composição falha não é
   * memoizada.
   */
  it('should not rename a composition failure as a signing failure', async () => {
    dependenciesMock.mockRejectedValue(new TokenSigningException('chave privada inválida'));

    const response = await handler(buildJsonEvent(CREDENTIAL), buildContext());

    expect(response.statusCode).toBe(500);
    expect(mocks.capture.lines()).toHaveLength(1);
    expect(invocationLine()?.['oficina.event.name']).toBeUndefined();
  });

  it('should name the technical failure without inventing a second event', async () => {
    grantAccess();
    mocks.tokenIssuer.issueAccessToken.mockRejectedValue(new TokenSigningException('kid'));

    await handler(buildJsonEvent(CREDENTIAL), buildContext());

    const events = mocks.capture
      .lines()
      .map((line) => line['oficina.event.name'])
      .filter(Boolean);

    expect(events).toEqual(['auth.customer.token.signing.failed']);
  });

  describe('execution attributes and correlation', () => {
    it('should reuse an inbound correlation header', async () => {
      grantAccess();

      await handler(
        buildJsonEvent(CREDENTIAL, {
          headers: { 'content-type': 'application/json', 'x-request-id': 'req-do-gateway' },
        }),
        buildContext(),
      );

      mocks.capture.lines().forEach((line) => expect(line['request.id']).toBe('req-do-gateway'));
    });

    it('should fall back to the invocation id when no header arrives', async () => {
      grantAccess();
      const context = buildContext();

      await handler(buildJsonEvent(CREDENTIAL), context);

      mocks.capture
        .lines()
        .forEach((line) => expect(line['request.id']).toBe(context.awsRequestId));
    });

    it('should carry the trace id of the traceparent on every invocation line', async () => {
      grantAccess();

      await handler(buildJsonEvent(CREDENTIAL), buildContext());

      expect(mocks.capture.lines()).toHaveLength(2);
      mocks.capture.lines().forEach((line) => expect(line.trace_id).toBe(sentTraceId()));
    });

    it('should carry a trace id on the 400 and on the composition failure lines', async () => {
      await handler(buildEvent({ body: '{' }), buildContext());

      dependenciesMock.mockRejectedValue(new Error('secrets manager indisponível'));

      await handler(buildJsonEvent(CREDENTIAL), buildContext());

      const lines = mocks.capture.lines();

      expect(lines).toHaveLength(3);
      lines.forEach((line) => expect(line.trace_id).toMatch(/^[0-9a-f]{32}$/));
      expect(lines[0].trace_id).not.toBe(lines[2].trace_id);
    });

    it('should carry the cold start flag on every line', async () => {
      grantAccess();

      await handler(buildJsonEvent(CREDENTIAL), buildContext());

      mocks.capture
        .lines()
        .forEach((line) => expect(typeof line['faas.coldstart']).toBe('boolean'));
    });
  });

  describe('protection of what reaches the log', () => {
    it('should keep every emitted key inside the dictionary', async () => {
      grantAccess();

      await handler(buildJsonEvent(CREDENTIAL), buildContext());

      const keys = new Set(mocks.capture.lines().flatMap((line) => Object.keys(line)));

      expect([...keys].filter((key) => !DECLARED_FIELD_NAMES.has(key))).toEqual([]);
    });

    /**
     * O corpo da requisição não é registrado em hipótese alguma. O terceiro caso
     * é o que uma classificação por nome de campo não pegaria: a credencial
     * repetida sob uma chave semanticamente neutra.
     */
    it.each([
      ['the canonical field', { password: 'Senha@123' }],
      ['a portuguese variant', { senha: 'Senha@123' }],
      ['a neutral key', { password: 'x', note: 'Senha@123' }],
    ])('should never write the request body — %s', async (_case, body) => {
      await handler(buildJsonEvent({ ...body, cpf: '111.111.111-11' }), buildContext());

      expect(mocks.capture.raw()).not.toContain('Senha@123');
    });

    it('should never write the plain cpf', async () => {
      grantAccess();

      await handler(buildJsonEvent(CREDENTIAL), buildContext());

      expect(mocks.capture.raw()).not.toContain(VALID_CPF);
      expect(mocks.capture.raw()).not.toContain(FORMATTED_CPF);
      expect(mocks.capture.raw()).toContain('***.***.789-09');
    });

    it('should not write the issued token', async () => {
      grantAccess();

      await handler(buildJsonEvent(CREDENTIAL), buildContext());

      expect(mocks.capture.raw()).not.toContain('jwt.token.value');
    });
  });
});
