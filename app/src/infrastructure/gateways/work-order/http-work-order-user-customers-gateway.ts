import { IWorkOrderUserCustomersGateway } from '@application/ports/output/gateways/work-order/work-order-user-customers-gateway.interface';
import { WorkOrderUserCustomerGatewayResponse } from '@application/ports/output/gateways/work-order/work-order-user-customers-gateway.response';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';

export class HttpWorkOrderUserCustomersGateway implements IWorkOrderUserCustomersGateway {
  constructor(
    private readonly internalHttpClient: InternalHttpClient,
    private readonly workOrderInternalUrl: string,
  ) {}

  async findActiveByUserId(userId: string): Promise<WorkOrderUserCustomerGatewayResponse[]> {
    const path = `/internal/users/${userId}/customers`;

    const answer = await this.internalHttpClient.request<{
      data?: WorkOrderUserCustomerGatewayResponse[];
    } | null>({
      method: 'GET',
      baseUrl: this.workOrderInternalUrl,
      path,
    });

    const customers = answer?.data;

    // Without the list the link cannot be checked, and an unchecked link must never issue a token.
    if (!Array.isArray(customers)) {
      throw new ServiceIntegrationException(`GET ${path}`);
    }

    return customers;
  }
}
