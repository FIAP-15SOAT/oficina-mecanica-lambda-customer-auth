import { IWorkOrderUserCustomersGateway } from '@application/ports/output/gateways/work-order/work-order-user-customers-gateway.interface';
import { WorkOrderUserCustomerGatewayResponse } from '@application/ports/output/gateways/work-order/work-order-user-customers-gateway.response';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';

export class HttpWorkOrderUserCustomersGateway implements IWorkOrderUserCustomersGateway {
  constructor(
    private readonly internalHttpClient: InternalHttpClient,
    private readonly workOrderInternalUrl: string,
  ) {}

  async findActiveByUserId(userId: string): Promise<WorkOrderUserCustomerGatewayResponse[]> {
    const { data } = await this.internalHttpClient.request<{
      data: WorkOrderUserCustomerGatewayResponse[];
    }>({
      method: 'GET',
      baseUrl: this.workOrderInternalUrl,
      path: `/internal/users/${userId}/customers`,
    });

    return data;
  }
}
