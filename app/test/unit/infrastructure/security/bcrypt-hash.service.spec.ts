import { InvocationTimings } from '@infrastructure/observability/invocation-timings';
import { BcryptHashService } from '@infrastructure/security/bcrypt-hash.service';

/**
 * Hash produzido pela biblioteca bcrypt **nativa** que a API usa, com custo 12.
 * É a premissa da decisão de trocar o módulo nativo por JavaScript puro: os dois
 * verificam exatamente os mesmos hashes.
 */
const PASSWORD = 'Senha@123';
const NATIVE_HASH = '$2b$12$p6XVg4lX9xZMx5lcA6Id3eXPSczStxFpu6y8gm9fz5W.shfjpI9tK';

describe('BcryptHashService', () => {
  let timings: InvocationTimings;
  let service: BcryptHashService;

  beforeEach(() => {
    timings = new InvocationTimings();
    service = new BcryptHashService(timings);
  });

  it('should accept a hash produced by the API native library', async () => {
    await expect(service.compare(PASSWORD, NATIVE_HASH)).resolves.toBe(true);
  });

  it('should reject a password that does not match the stored hash', async () => {
    await expect(service.compare(`${PASSWORD}-errada`, NATIVE_HASH)).resolves.toBe(false);
    await expect(service.compare('', NATIVE_HASH)).resolves.toBe(false);
  });

  it('should record the verification duration for the invocation line', async () => {
    await service.compare(PASSWORD, NATIVE_HASH);

    expect(timings.snapshot().passwordVerificationDurationMs).toBeGreaterThan(0);
  });
});
