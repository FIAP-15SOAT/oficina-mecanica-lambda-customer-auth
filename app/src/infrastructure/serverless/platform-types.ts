import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type HandlerResponse = APIGatewayProxyStructuredResultV2 & { statusCode: number };
