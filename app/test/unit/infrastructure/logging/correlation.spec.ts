import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_ATTRIBUTE,
  REQUEST_ID_HEADER,
  resolveCorrelationId,
} from '@infrastructure/logging/correlation';

const INVOCATION_ID = '8f0c4b0e-1b7c-4a1a-9a0a-9b1e8c6d2f31';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveCorrelationId', () => {
  it('should use the same attribute name the API uses as the join key', () => {
    expect(REQUEST_ID_ATTRIBUTE).toBe('request.id');
  });

  it.each([REQUEST_ID_HEADER, CORRELATION_ID_HEADER])(
    'should reuse a valid inbound %s',
    (header) => {
      expect(resolveCorrelationId({ [header]: 'req-123.abc:9' }, INVOCATION_ID)).toBe(
        'req-123.abc:9',
      );
    },
  );

  it('should match the header regardless of case', () => {
    expect(resolveCorrelationId({ 'X-Request-Id': 'req-abc' }, INVOCATION_ID)).toBe('req-abc');
  });

  it('should prefer the request id header over the correlation id header', () => {
    expect(
      resolveCorrelationId(
        { [REQUEST_ID_HEADER]: 'primeiro', [CORRELATION_ID_HEADER]: 'segundo' },
        INVOCATION_ID,
      ),
    ).toBe('primeiro');
  });

  it('should fall back to the invocation id when no header arrives', () => {
    expect(resolveCorrelationId({}, INVOCATION_ID)).toBe(INVOCATION_ID);
    expect(resolveCorrelationId(undefined, INVOCATION_ID)).toBe(INVOCATION_ID);
  });

  it.each([
    ['spaces', 'req 123'],
    ['a character outside the alphabet', 'req/123'],
    ['a length above the limit', 'a'.repeat(129)],
    ['an empty value', ''],
    ['content the sanitizer would rewrite', '12345678909'],
  ])('should discard an inbound id with %s', (_case, value) => {
    expect(resolveCorrelationId({ [REQUEST_ID_HEADER]: value }, INVOCATION_ID)).toBe(INVOCATION_ID);
  });

  it('should generate an identifier when neither header nor invocation id is usable', () => {
    expect(resolveCorrelationId({}, undefined)).toMatch(UUID_SHAPE);
    expect(resolveCorrelationId({}, 'invocação inválida')).toMatch(UUID_SHAPE);
  });

  it('should never leave the line without a key, even if resolution throws', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new RangeError('hostil');
        },
      },
    ) as Record<string, string | undefined>;

    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(resolveCorrelationId(hostile, INVOCATION_ID)).toMatch(UUID_SHAPE);
    expect(String(stderr.mock.calls[0][0])).toContain(
      '"oficina.logging.failure.stage":"request-id"',
    );

    stderr.mockRestore();
  });
});
