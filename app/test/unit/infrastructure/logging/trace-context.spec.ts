import { createTraceContext } from '@infrastructure/logging/trace-context';

const TRACEPARENT_SHAPE = /^00-([0-9a-f]{32})-[0-9a-f]{16}-01$/;

describe('createTraceContext', () => {
  it('should build a sampled W3C traceparent carrying the trace id', () => {
    const { traceId, traceparent } = createTraceContext();

    expect(traceparent).toMatch(TRACEPARENT_SHAPE);
    expect(TRACEPARENT_SHAPE.exec(traceparent)?.[1]).toBe(traceId);
  });

  it('should start a new trace on every call', () => {
    const first = createTraceContext();
    const second = createTraceContext();

    expect(second.traceId).not.toBe(first.traceId);
    expect(second.traceparent).not.toBe(first.traceparent);
  });
});
