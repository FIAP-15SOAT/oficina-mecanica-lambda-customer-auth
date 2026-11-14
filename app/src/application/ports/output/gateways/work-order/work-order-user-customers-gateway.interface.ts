import { WorkOrderUserCustomerGatewayResponse } from './work-order-user-customers-gateway.response';

export interface IWorkOrderUserCustomersGateway {
  findActiveByUserId(userId: string): Promise<WorkOrderUserCustomerGatewayResponse[]>;
}
