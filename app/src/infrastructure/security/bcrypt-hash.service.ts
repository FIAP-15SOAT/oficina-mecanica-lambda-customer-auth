import { compare } from 'bcryptjs';

import { IHashService } from '@application/ports/output/hash.service.interface';
import { InvocationTimings } from '@infrastructure/observability/invocation-timings';

export class BcryptHashService implements IHashService {
  constructor(private readonly timings: InvocationTimings) {}

  async compare(value: string, hashed: string): Promise<boolean> {
    return this.timings.measure('passwordVerificationDurationMs', () => compare(value, hashed));
  }
}
