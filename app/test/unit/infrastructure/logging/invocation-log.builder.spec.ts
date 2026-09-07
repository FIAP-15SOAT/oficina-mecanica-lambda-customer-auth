import {
  buildInvocationLogLine,
  DURATION_ATTRIBUTE,
  INVOCATION_LOG_MESSAGE,
  PASSWORD_DURATION_ATTRIBUTE,
  QUERY_DURATION_ATTRIBUTE,
  resolveInvocationLogLevel,
} from '@infrastructure/logging/invocation-log.builder';
import { DatabaseOperationException } from '@infrastructure/exceptions/database-operation.exception';

const BASE = { method: 'POST', statusCode: 200, durationMs: 412.5 };

describe('resolveInvocationLogLevel', () => {
  it.each([
    [200, 'info'],
    [201, 'info'],
    [400, 'warn'],
    [401, 'warn'],
    [499, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ])('should map %s to %s', (status, level) => {
    expect(resolveInvocationLogLevel(status)).toBe(level);
  });
});

describe('buildInvocationLogLine', () => {
  it('should reuse the message the API uses for its per-request record', () => {
    expect(INVOCATION_LOG_MESSAGE).toBe('http request');
    expect(buildInvocationLogLine(BASE).message).toBe('http request');
  });

  it('should carry the three durations in fields of their own', () => {
    const { record } = buildInvocationLogLine({
      ...BASE,
      queryDurationMs: 12.5,
      passwordVerificationDurationMs: 271.25,
    });

    expect(record[DURATION_ATTRIBUTE]).toBe(412.5);
    expect(record[QUERY_DURATION_ATTRIBUTE]).toBe(12.5);
    expect(record[PASSWORD_DURATION_ATTRIBUTE]).toBe(271.25);
  });

  it('should omit a phase that did not run', () => {
    const { record } = buildInvocationLogLine(BASE);

    expect(record).not.toHaveProperty([QUERY_DURATION_ATTRIBUTE]);
    expect(record).not.toHaveProperty([PASSWORD_DURATION_ATTRIBUTE]);
  });

  it('should describe the request and the response status', () => {
    const { record, level } = buildInvocationLogLine({ ...BASE, statusCode: 401 });

    expect(record['http.request.method']).toBe('POST');
    expect(record['http.response.status_code']).toBe(401);
    expect(level).toBe('warn');
  });

  it('should carry the sanitized message but no stack trace below a server error', () => {
    const { record } = buildInvocationLogLine({
      ...BASE,
      statusCode: 400,
      error: new Error('CPF inválido'),
    });

    expect(record['error.type']).toBe('Error');
    expect(record['oficina.error.message']).toBe('CPF inválido');
    expect(record).not.toHaveProperty(['exception.stacktrace']);
  });

  it('should carry the full exception on a server error', () => {
    const { record } = buildInvocationLogLine({
      ...BASE,
      statusCode: 503,
      error: new DatabaseOperationException('busca', { cause: new Error('timeout') }),
    });

    expect(record['error.type']).toBe('DatabaseOperationException');
    expect(record['exception.message']).toBe('Erro na operação busca');
    // A causa do driver entra pela cadeia, não pela mensagem: é o que distingue
    // estouro de tempo de DNS, autenticação ou TLS num mesmo 503.
    expect(String(record['exception.stacktrace'])).toContain('Caused by:');
    expect(String(record['exception.stacktrace'])).toContain('timeout');
  });

  it('should not carry error attributes on success', () => {
    const { record } = buildInvocationLogLine(BASE);

    expect(record).not.toHaveProperty(['error.type']);
  });
});

describe('buildInvocationLogLine — degradation', () => {
  it('should degrade to an empty record instead of breaking the line', () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    const { record, level } = buildInvocationLogLine({
      ...BASE,
      statusCode: 500,
      get durationMs(): number {
        throw new RangeError('hostil');
      },
    });

    expect(record).toEqual({});
    expect(level).toBe('error');
    expect(String(stderr.mock.calls[0][0])).toContain(
      '"oficina.logging.failure.stage":"invocation-log"',
    );

    stderr.mockRestore();
  });
});
