import { InvocationTimings } from '@infrastructure/observability/invocation-timings';

describe('InvocationTimings', () => {
  let timings: InvocationTimings;

  beforeEach(() => {
    timings = new InvocationTimings();
  });

  it('should start with no phase measured', () => {
    expect(timings.snapshot()).toEqual({});
  });

  it.each(['queryDurationMs', 'passwordVerificationDurationMs'] as const)(
    'should record the duration of %s',
    async (phase) => {
      await timings.measure(phase, () => Promise.resolve('ok'));

      expect(timings.snapshot()[phase]).toEqual(expect.any(Number));
    },
  );

  it('should return the value the measured operation resolves with', async () => {
    await expect(timings.measure('queryDurationMs', () => Promise.resolve(42))).resolves.toBe(42);
  });

  /**
   * A duração é registrada também quando a operação falha: "a consulta levou
   * 5 s e estourou" é o diagnóstico procurado, e o status da resposta na mesma
   * linha distingue sucesso de falha.
   */
  it('should record the duration of a failed operation and rethrow', async () => {
    await expect(
      timings.measure('queryDurationMs', () => Promise.reject(new Error('timeout'))),
    ).rejects.toThrow('timeout');

    expect(timings.snapshot().queryDurationMs).toEqual(expect.any(Number));
  });

  it('should forget the previous invocation on reset', async () => {
    await timings.measure('queryDurationMs', () => Promise.resolve('ok'));

    timings.reset();

    expect(timings.snapshot()).toEqual({});
  });

  it('should hand out a copy, so a caller cannot mutate the collector', async () => {
    await timings.measure('queryDurationMs', () => Promise.resolve('ok'));

    const snapshot = timings.snapshot();
    snapshot.queryDurationMs = 999;

    expect(timings.snapshot().queryDurationMs).not.toBe(999);
  });
});
