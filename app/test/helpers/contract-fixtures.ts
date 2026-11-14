import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IdentityCustomerAuthenticationGatewayResponse } from '@application/ports/output/gateways/identity/identity-customer-credentials-gateway.response';
import { WorkOrderUserCustomerGatewayResponse } from '@application/ports/output/gateways/work-order/work-order-user-customers-gateway.response';

// The `$source` header records where the fixture was copied from; it is not part of the contract.
function readFixtureData(path: string): unknown {
  const fixture = JSON.parse(readFileSync(join(__dirname, '../contracts', path), 'utf8')) as {
    data: unknown;
  };

  return fixture.data;
}

export function readCustomerAuthenticationFixture(): IdentityCustomerAuthenticationGatewayResponse {
  return readFixtureData(
    'identity/internal-customer-authentication.json',
  ) as IdentityCustomerAuthenticationGatewayResponse;
}

export function readUserCustomersFixture(): WorkOrderUserCustomerGatewayResponse[] {
  return readFixtureData(
    'work-order/internal-user-customers.json',
  ) as WorkOrderUserCustomerGatewayResponse[];
}
