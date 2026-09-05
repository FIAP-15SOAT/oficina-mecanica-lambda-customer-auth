import { ILogger } from '@application/ports/output/logger.service.interface';
import { IHashService } from '@application/ports/output/hash.service.interface';
import { ITokenIssuerService } from '@application/ports/output/token-issuer.service.interface';
import { CustomerUser } from '@domain/entities/customer-user.entity';
import { ICustomerIdentityRepository } from '@domain/interfaces/repositories/customer-identity.repository.interface';

export const VALID_CPF = '12345678909';
export const FORMATTED_CPF = '123.456.789-09';
export const MASKED_CPF = '***.***.789-09';
export const SUBJECT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
export const STORED_HASH = '$2b$12$storedhashstoredhashsto';

export function createMockCustomerUser(overrides: Partial<CustomerUser> = {}): CustomerUser {
  return CustomerUser.create({
    id: overrides.id ?? SUBJECT_ID,
    passwordHash: overrides.passwordHash ?? STORED_HASH,
    isActive: overrides.isActive ?? true,
    hasActiveCustomerLink: overrides.hasActiveCustomerLink ?? true,
  });
}

export function createMockIdentityRepository(): jest.Mocked<ICustomerIdentityRepository> {
  return { findByCpf: jest.fn().mockResolvedValue(null) };
}

export function createMockHashService(): jest.Mocked<IHashService> {
  return { compare: jest.fn().mockResolvedValue(false) };
}

export function createMockTokenIssuer(): jest.Mocked<ITokenIssuerService> {
  return {
    issueAccessToken: jest
      .fn()
      .mockResolvedValue({ accessToken: 'jwt.token.value', expiresIn: 3600 }),
  };
}

export interface MockLogger extends ILogger {
  readonly events: { name: string; level: string; fields: Record<string, unknown> }[];
  eventNamed(
    name: string,
  ): { name: string; level: string; fields: Record<string, unknown> } | undefined;
}

export function createMockLogger(): MockLogger {
  const events: MockLogger['events'] = [];

  return {
    events,
    eventNamed: (name) => events.find((entry) => entry.name === name),
    error: jest.fn(),
    event: (definition, fields) => {
      events.push({
        name: definition.name,
        level: definition.level,
        fields: fields,
      });
    },
  };
}
