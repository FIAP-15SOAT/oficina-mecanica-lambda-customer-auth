import { randomBytes } from 'node:crypto';

export const TRACE_ID_ATTRIBUTE = 'trace_id';

export interface TraceContext {
  traceId: string;
  traceparent: string;
}

export function createTraceContext(): TraceContext {
  const traceId = randomBytes(16).toString('hex');

  return { traceId, traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01` };
}
