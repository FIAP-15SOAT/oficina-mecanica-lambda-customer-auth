import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import { captureLog, TEST_RESOURCE } from '../../../helpers/log-capture';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('PinoLoggerAdapter — envelope', () => {
  it('should write one independent, parseable JSON object per line', () => {
    const capture = captureLog();

    capture.adapter.emitRecord('info', 'primeira', {});
    capture.adapter.emitRecord('warn', 'segunda', {});

    const rendered = capture
      .raw()
      .split('\n')
      .filter((line) => line.length > 0);

    expect(rendered).toHaveLength(2);
    rendered.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
  });

  it('should carry timestamp in ISO-8601 UTC, a textual level and a stable message', () => {
    const capture = captureLog();

    capture.adapter.emitRecord('warn', 'customer credentials rejected', {});

    const [line] = capture.lines();

    expect(line.timestamp).toEqual(expect.stringMatching(ISO_UTC));
    expect(line.level).toBe('warn');
    expect(line.message).toBe('customer credentials rejected');
  });

  it('should carry the resource attributes and nothing about machine or process', () => {
    const capture = captureLog();

    capture.adapter.emitRecord('info', 'x', {});

    const [line] = capture.lines();

    expect(line).toMatchObject(TEST_RESOURCE);
    expect(line.pid).toBeUndefined();
    expect(line.hostname).toBeUndefined();
  });

  it('should describe an error attached to the error level', () => {
    const capture = captureLog();

    capture.adapter.error('quebrou', new TypeError('detalhe'));
    capture.adapter.error('sem erro anexado');

    const [withError, withoutError] = capture.lines();

    expect(withError).toMatchObject({
      level: 'error',
      'exception.type': 'TypeError',
      'exception.message': 'detalhe',
    });
    expect(withError['exception.stacktrace']).toEqual(expect.any(String));
    expect(withoutError['exception.type']).toBeUndefined();
  });

  it('should bind the invocation attributes to every line it emits', () => {
    const capture = captureLog();

    capture.adapter
      .forInvocation({ 'faas.coldstart': true, 'request.id': 'req-1' })
      .emitRecord('info', 'x', {});

    expect(capture.lines()[0]).toMatchObject({ 'faas.coldstart': true, 'request.id': 'req-1' });
  });
});

describe('PinoLoggerAdapter — catalog and dictionary', () => {
  it('should emit the event name, level and message from the catalog', () => {
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.AUTHENTICATION_SUCCEEDED, {
      subjectId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      maskedCpf: '123.456.789-09',
    });

    expect(capture.lines()[0]).toMatchObject({
      level: 'info',
      message: 'customer credentials accepted and access token issued',
      'oficina.event.name': 'auth.customer.authentication.succeeded',
      'oficina.auth.subject.id': '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });
  });

  /**
   * O CPF é protegido pela classificação do registro, não por mascaramento no
   * ponto de chamada — a chamada passa a forma pontuada e o adapter mascara.
   */
  it('should mask a field declared as personal data', () => {
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
      failureReason: 'wrong_password',
      maskedCpf: '123.456.789-09',
    });

    const [line] = capture.lines();

    expect(line['oficina.auth.subject.cpf_masked']).toBe('***.***.789-09');
    expect(capture.raw()).not.toContain('123.456.789-09');
  });

  it('should pass a non-textual value through untouched', () => {
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
      failureReason: 42,
      maskedCpf: '123.456.789-09',
    } as never);

    expect(capture.lines()[0]['oficina.auth.failure.reason']).toBe(42);
  });

  it('should skip absent optional fields instead of emitting null', () => {
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
      failureReason: 'unknown_user',
      maskedCpf: '123.456.789-09',
      subjectId: undefined,
    });

    expect(capture.lines()[0]['oficina.auth.subject.id']).toBeUndefined();
  });

  it('should report a logical field the registry does not know and drop it', () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
      failureReason: 'unknown_user',
      quoteId: 'x',
    } as never);

    expect(String(stderr.mock.calls[0][0])).toContain('"oficina.logging.failure.field":"quoteId"');
    expect(capture.raw()).not.toContain('quoteId');

    stderr.mockRestore();
  });

  it('should attach the described error to a technical event', () => {
    const capture = captureLog();

    capture.adapter.event(TECHNICAL_EVENTS.DATABASE_QUERY_FAILED, {}, new Error('timeout'));

    expect(capture.lines()[0]).toMatchObject({
      level: 'error',
      'oficina.event.name': 'db.query.failed',
      'exception.message': 'timeout',
    });
  });

  it('should not let a failing record build interrupt the caller', () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const capture = captureLog();

    const hostile = {
      get failureReason(): string {
        throw new RangeError('hostil');
      },
    };

    expect(() =>
      capture.adapter.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, hostile as never),
    ).not.toThrow();
    expect(String(stderr.mock.calls[0][0])).toContain('"oficina.logging.failure.stage":"emit"');

    stderr.mockRestore();
  });

  it('should emit an invocation record at the level the caller resolved', () => {
    const capture = captureLog();

    capture.adapter.emitRecord('error', 'http request', {
      'http.response.status_code': 503,
    });

    expect(capture.lines()[0]).toMatchObject({
      level: 'error',
      message: 'http request',
      'http.response.status_code': 503,
    });
  });
});
