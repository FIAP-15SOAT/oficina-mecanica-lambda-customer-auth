import {
  MAX_BODY_BYTES,
  validateLoginEvent,
} from '@infrastructure/serverless/login-event.validator';

import { buildEvent, buildJsonEvent } from '../../../helpers/platform-event.factory';

describe('validateLoginEvent', () => {
  it('should accept a well formed credential', () => {
    const result = validateLoginEvent(
      buildJsonEvent({ cpf: '12345678909', password: 'Senha@123' }),
    );

    expect(result).toEqual({ ok: true, request: { cpf: '12345678909', password: 'Senha@123' } });
  });

  it('should ignore fields beyond the contract', () => {
    const result = validateLoginEvent(
      buildJsonEvent({ cpf: '12345678909', password: 'Senha@123', extra: 'x' }),
    );

    expect(result).toEqual({ ok: true, request: { cpf: '12345678909', password: 'Senha@123' } });
  });

  it('should decode a base64 encoded body', () => {
    const event = buildEvent({
      body: Buffer.from(JSON.stringify({ cpf: '12345678909', password: 'x' })).toString('base64'),
      isBase64Encoded: true,
    });

    expect(validateLoginEvent(event)).toMatchObject({ ok: true });
  });

  it.each([
    ['missing_body', buildEvent({})],
    ['missing_body', buildEvent({ body: '' })],
    ['malformed_body', buildEvent({ body: '{' })],
    ['malformed_body', buildEvent({ body: '"apenas uma string"' })],
    ['malformed_body', buildEvent({ body: '[1,2,3]' })],
    ['invalid_credentials', buildJsonEvent({ cpf: '12345678909' })],
    ['invalid_credentials', buildJsonEvent({ password: 'Senha@123' })],
    ['invalid_credentials', buildJsonEvent({ cpf: 12345678909, password: 'Senha@123' })],
    ['invalid_credentials', buildJsonEvent({ cpf: '12345678909', password: null })],
    ['invalid_credentials', buildJsonEvent({ cpf: '', password: 'Senha@123' })],
  ])('should reject with %s', (reason, event) => {
    expect(validateLoginEvent(event)).toEqual({ ok: false, reason });
  });

  /**
   * O limite existe antes de qualquer desserialização: o gateway já restringe a
   * carga, mas a função não pode depender disso para decidir quanto texto vai
   * processar.
   */
  it('should reject a body past the accepted size', () => {
    const event = buildJsonEvent({ cpf: '12345678909', password: 'x'.repeat(MAX_BODY_BYTES) });

    expect(validateLoginEvent(event)).toEqual({ ok: false, reason: 'body_too_large' });
  });

  /**
   * Método e rota são do gateway, que serve um caminho e um verbo só. Repetir a
   * checagem aqui recusaria requisição legítima sem ganho.
   */
  it('should not second-guess the gateway about the method', () => {
    const event = buildJsonEvent({ cpf: '12345678909', password: 'x' }, { method: 'GET' });

    expect(validateLoginEvent(event)).toMatchObject({ ok: true });
  });
});
