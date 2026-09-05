import { APIGatewayProxyEventV2, Context } from 'aws-lambda';

import { BadRequestException } from '@application/exceptions/bad-request.exception';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { REQUEST_ID_ATTRIBUTE, resolveCorrelationId } from '@infrastructure/logging/correlation';
import { resolveExecutionAttributes } from '@infrastructure/logging/execution-attributes';
import { buildInvocationLogLine } from '@infrastructure/logging/invocation-log.builder';
import { HandlerResponse } from '@infrastructure/serverless/platform-types';
import { validateLoginEvent } from '@infrastructure/serverless/login-event.validator';
import {
  buildErrorResponse,
  buildSuccessResponse,
  inputRejectionMessage,
  resolveTechnicalEvent,
} from '@infrastructure/serverless/response.translator';

import { Dependencies, getBaseLogger, getDependencies } from './bootstrap';

/**
 * Começa a composição durante a **inicialização do ambiente**, em vez de esperar
 * a primeira invocação. Sem isso, a primeira credencial real pagaria o
 * gerenciador de segredos e a importação do PEM.
 *
 * O handshake do banco fica **de fora**: o pool é preguiçoso e só conecta na
 * primeira consulta. É proposital — abrir a conexão aqui faria um banco
 * indisponível derrubar a composição inteira, trocando o `503` correto por um
 * `500` de inicialização.
 *
 * A rejeição é engolida de propósito: `getDependencies` já registra a causa e
 * descarta o cache, e a invocação seguinte reencontra o erro.
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

  const logger = getBaseLogger().forInvocation({
    ...resolveExecutionAttributes(context),
    [REQUEST_ID_ATTRIBUTE]: resolveCorrelationId(event.headers, context.awsRequestId),
  });

  let timings: Dependencies['timings'] | undefined;
  let failure: unknown;
  let response: HandlerResponse;
  let composed = false;

  try {
    const dependencies = await getDependencies();

    composed = true;
    timings = dependencies.timings;
    timings.reset();

    const validation = validateLoginEvent(event);

    if (!validation.ok) {
      logger.event(BUSINESS_EVENTS.AUTHENTICATION_INPUT_REJECTED, {
        failureReason: validation.reason,
      });

      throw new BadRequestException(inputRejectionMessage(validation.reason));
    }

    response = buildSuccessResponse(
      await dependencies.createController(logger).login(validation.request),
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
    ...timings?.snapshot(),
    ...(failure === undefined ? {} : { error: failure }),
  });

  logger.emitRecord(line.level, line.message, line.record);

  return response;
}
