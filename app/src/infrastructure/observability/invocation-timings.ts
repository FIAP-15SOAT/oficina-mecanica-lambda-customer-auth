export type InvocationPhase = 'queryDurationMs' | 'passwordVerificationDurationMs';

export type InvocationTimingsSnapshot = Partial<Record<InvocationPhase, number>>;

export class InvocationTimings {
  private durations: InvocationTimingsSnapshot = {};

  reset(): void {
    this.durations = {};
  }

  snapshot(): InvocationTimingsSnapshot {
    return { ...this.durations };
  }

  async measure<T>(phase: InvocationPhase, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();

    try {
      return await operation();
    } finally {
      this.durations[phase] = performance.now() - started;
    }
  }
}
