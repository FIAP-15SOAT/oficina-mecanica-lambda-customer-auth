import { normalizeLogRecord } from '@infrastructure/logging/log-record-normalizer';
import { captureDiagnostics } from '../../../helpers/diagnostics-capture';

describe('normalizeLogRecord', () => {
  it('should keep a declared attribute', () => {
    expect(normalizeLogRecord({ 'http.request.method': 'POST' })).toEqual({
      'http.request.method': 'POST',
    });
  });

  /**
   * Último portão antes da linha sair. Um atributo novo que escapasse sem
   * declaração chega ao backend com tipo indefinido — e um campo cujo tipo varia
   * entre registros faz o índice derrubar o evento inteiro, não só o campo.
   */
  it('should drop an attribute the registry does not declare', () => {
    expect(
      normalizeLogRecord({ 'http.request.method': 'POST', customerName: 'Maria Silva' }),
    ).toEqual({
      'http.request.method': 'POST',
    });
  });

  it('should drop the library default keys', () => {
    expect(
      normalizeLogRecord({ req: {}, res: {}, responseTime: 12, context: 'RouterExplorer' }),
    ).toEqual({});
  });

  it.each(['err', 'error'])(
    'should convert the error attached under "%s" into the exception attributes',
    (key) => {
      const normalized = normalizeLogRecord({ [key]: new TypeError('quebrou') });

      expect(normalized).toMatchObject({
        'exception.type': 'TypeError',
        'exception.message': 'quebrou',
      });
      expect(normalized).not.toHaveProperty(key);
    },
  );

  it('should drop a non-error value carried under an error key', () => {
    expect(normalizeLogRecord({ err: 'apenas texto' })).toEqual({});
  });

  it('should absorb a throwing getter and report it without breaking the line', () => {
    const stderr = captureDiagnostics();

    const record: Record<string, unknown> = { 'http.request.method': 'POST' };

    Object.defineProperty(record, 'err', {
      enumerable: true,
      get: () => {
        throw new RangeError('getter hostil');
      },
    });

    expect(normalizeLogRecord(record)).toEqual({ 'http.request.method': 'POST' });
    expect(String(stderr.spy.mock.calls[0][0])).toContain(
      '"oficina.logging.failure.error_type":"RangeError"',
    );

    stderr.restore();
  });

  it('should describe a thrown non-error raised while normalizing', () => {
    const stderr = captureDiagnostics();

    const record: Record<string, unknown> = {};

    Object.defineProperty(record, 'err', {
      enumerable: true,
      get: () => {
        throw 'texto solto';
      },
    });

    normalizeLogRecord(record);

    expect(String(stderr.spy.mock.calls[0][0])).toContain(
      '"oficina.logging.failure.error_type":"string"',
    );

    stderr.restore();
  });
});
