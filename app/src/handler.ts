import { APIGatewayProxyEventV2, Context } from 'aws-lambda';

import { BadRequestException } from '@application/exceptions/bad-request.exception';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { REQUEST_ID_ATTRIBUTE, resolveCorrelationId } from '@infrastructure/logging/correlation';
import { resolveExecutionAttributes } from '@infrastructure/logging/execution-attributes';
import { buildInvocationLogLine } from '@infrastructure/logging/invocation-log.builder';
import { createTraceContext, TRACE_ID_ATTRIBUTE } from '@infrastructure/logging/trace-context';
import { HandlerResponse } from '@infrastructure/serverless/platform-types';
import { validateLoginEvent } from '@infrastructure/serverless/login-event.validator';
import {
  buildErrorResponse,
  buildSuccessResponse,
  inputRejectionMessage,
  resolveTechnicalEvent,
} from '@infrastructure/serverless/response.translator';

import { getBaseLogger, getDependencies } from './bootstrap';

/**
 * Starts the composition during **environment initialization** instead of
 * waiting for the first invocation. Without it, the first real credential would
 * pay for the secrets manager and the PEM import.
 *
 * The Identity and work-order calls stay **out**: they belong to the invocation,
 * and an unavailable service answers it with `503` instead of failing the
 * composition with an initialization `500`.
 *
 * The rejection is swallowed on purpose: `getDependencies` already logs the
 * cause and drops the cache, and the next invocation meets the error again.
 */
export function warmUp(): void {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    void Promise.resolve(getDependencies()).catch(() => undefined);
  }
}

warmUp();

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<HandlerResponse> {
  const startedAt = performance.now();
  const requestId = resolveCorrelationId(event.headers, context.awsRequestId);
  const { traceId, traceparent } = createTraceContext();

  const logger = getBaseLogger().forInvocation({
    ...resolveExecutionAttributes(context),
    [REQUEST_ID_ATTRIBUTE]: requestId,
    [TRACE_ID_ATTRIBUTE]: traceId,
  });

  let failure: unknown;
  let response: HandlerResponse;
  let composed = false;

  try {
    const dependencies = await getDependencies();

    composed = true;

    const validation = validateLoginEvent(event);

    if (!validation.ok) {
      logger.event(BUSINESS_EVENTS.AUTHENTICATION_INPUT_REJECTED, {
        failureReason: validation.reason,
      });

      throw new BadRequestException(inputRejectionMessage(validation.reason));
    }

    response = buildSuccessResponse(
      await dependencies
        .createController(logger, { requestId, traceparent })
        .login(validation.request),
    );
  } catch (error) {
    failure = error;

    /**
     * Uma falha de composição já foi registrada com a sua causa em `bootstrap`,
     * como configuração inválida. Reclassificá-la aqui a anunciaria uma segunda
     * vez, e com outro nome — um PEM ilegível sairia também como falha de
     * assinatura, apontando o diagnóstico para o runtime em vez da implantação.
     */
    const technicalEvent = composed ? resolveTechnicalEvent(error) : undefined;

    if (technicalEvent) {
      logger.event(technicalEvent, {}, error);
    }

    response = buildErrorResponse(error);
  }

  const line = buildInvocationLogLine({
    method: event.requestContext?.http?.method ?? '',
    statusCode: response.statusCode,
    durationMs: performance.now() - startedAt,
    ...(failure === undefined ? {} : { error: failure }),
  });

  logger.emitRecord(line.level, line.message, line.record);

  return response;
}
