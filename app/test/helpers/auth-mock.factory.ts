import { IIdentityCustomerCredentialsGateway } from '@application/ports/output/gateways/identity/identity-customer-credentials-gateway.interface';
import { IWorkOrderUserCustomersGateway } from '@application/ports/output/gateways/work-order/work-order-user-customers-gateway.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { ITokenIssuerService } from '@application/ports/output/token-issuer.service.interface';

export const VALID_CPF = '12345678909';
export const FORMATTED_CPF = '123.456.789-09';
export const MASKED_CPF = '***.***.789-09';
export const SUBJECT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

export function createMockIdentityCustomerCredentialsGateway(): jest.Mocked<IIdentityCustomerCredentialsGateway> {
  return { authenticate: jest.fn().mockResolvedValue(null) };
}

export function createMockWorkOrderUserCustomersGateway(): jest.Mocked<IWorkOrderUserCustomersGateway> {
  return { findActiveByUserId: jest.fn().mockResolvedValue([]) };
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
