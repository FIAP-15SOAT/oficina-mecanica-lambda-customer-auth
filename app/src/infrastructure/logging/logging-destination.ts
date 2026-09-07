import pino, { DestinationStream } from 'pino';

import { reportDestinationFailure } from './logging-diagnostics';

/**
 * Destino padrão: stream para o fd 1 (stdout), em modo síncrono.
 *
 * `sync: true` porque o buffer assíncrono do pino perde as últimas linhas quando
 * o ambiente é congelado assim que a resposta retorna — e uma linha
 * bufferizada ficaria retida até a invocação seguinte, ou se perderia se o
 * ambiente fosse reciclado antes dela.
 *
 * O handler de `error` é obrigatório, não zelo: um evento `'error'` sem listener
 * em stream do Node derruba o processo, então um `stdout` quebrado — EPIPE
 * quando o coletor cai — faria o logging matar a aplicação que ele existe para
 * observar.
 */
export function createDefaultDestination(): DestinationStream {
  const destination = pino.destination({ dest: 1, sync: true });

  destination.on('error', () => reportDestinationFailure());

  return destination;
}
