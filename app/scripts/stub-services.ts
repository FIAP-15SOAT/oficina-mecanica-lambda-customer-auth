import {
  readCustomerAuthenticationFixture,
  readUserCustomersFixture,
} from '../test/helpers/contract-fixtures';
import { startInternalServicesStub } from '../test/helpers/internal-services-stub';

const STUB_PORT = 4010;

// The customer seeded in the Identity, the same one events/login.event.json sends.
const SEEDED_CUSTOMER_CPF = '12345678909';
const SEEDED_CUSTOMER_PASSWORD = 'Tech@2026';

async function serve(): Promise<void> {
  const internalServicesStub = await startInternalServicesStub(STUB_PORT);
  const { userId } = readCustomerAuthenticationFixture();

  internalServicesStub.credentials.set(SEEDED_CUSTOMER_CPF, {
    password: SEEDED_CUSTOMER_PASSWORD,
    userId,
  });

  internalServicesStub.userCustomers.set(userId, readUserCustomersFixture());

  console.log(`IDENTITY_INTERNAL_URL=${internalServicesStub.url}`);
  console.log(`WORK_ORDER_INTERNAL_URL=${internalServicesStub.url}`);
}

void serve().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
