import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The `$source` header records where the fixture was copied from; it is not part of the contract.
function readFixtureData(path: string): unknown {
  const fixture = JSON.parse(readFileSync(join(__dirname, '../contracts', path), 'utf8')) as {
    data: unknown;
  };

  return fixture.data;
}

export function readCustomerAuthenticationFixture(): { userId: string } {
  return readFixtureData('identity/internal-customer-authentication.json') as { userId: string };
}

export function readUserCustomersFixture(): {
  id: string;
  name: string;
  type: string;
  document: string;
  isActive: boolean;
}[] {
  return readFixtureData('work-order/internal-user-customers.json') as ReturnType<
    typeof readUserCustomersFixture
  >;
}
