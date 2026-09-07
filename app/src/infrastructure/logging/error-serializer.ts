import { sanitizeStackTrace, sanitizeText } from './redaction/text-sanitizer';

const MAX_CAUSE_DEPTH = 3;

/**
 * Nomes que não identificam nada: quando um erro embrulha outro, o wrapper
 * costuma ser um `Error` genérico e o nome útil está mais abaixo na cadeia.
 */
const GENERIC_ERROR_NAMES = new Set(['Error', 'Object']);

export interface ExceptionAttributes {
  'exception.type': string;
  'exception.message': string;
  'exception.stacktrace'?: string;
}

export function describeError(error: unknown): ExceptionAttributes {
  const chain = collectCauseChain(error);
  const stacktrace = joinStackTraces(chain);

  return {
    'exception.type': resolveChainErrorType(chain),
    'exception.message': resolveErrorMessage(error),
    ...(stacktrace ? { 'exception.stacktrace': stacktrace } : {}),
  };
}

export function resolveErrorType(error: unknown): string {
  return resolveChainErrorType(collectCauseChain(error));
}

function resolveChainErrorType(chain: ErrorChainEntry[]): string {
  const specific = chain.find((entry) => !GENERIC_ERROR_NAMES.has(entry.name));

  return specific?.name ?? chain[0]?.name ?? 'UnknownError';
}

export function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeText(error.message);
  }

  if (typeof error === 'string') {
    return sanitizeText(error);
  }

  return 'Unknown error';
}

interface ErrorChainEntry {
  name: string;
  stack?: string;
}

/**
 * Percorre a cadeia `error.cause` (ES2022), em que um erro embrulha o anterior.
 * Sem ela, um erro relançado por biblioteca (Prisma, nodemailer) apareceria como
 * `exception.type: "Error"` e com o stack do wrapper — perdendo a linha que de
 * fato quebrou. A profundidade é limitada e os erros já vistos são registrados
 * porque `cause` pode formar ciclo.
 */
function collectCauseChain(error: unknown): ErrorChainEntry[] {
  const chain: ErrorChainEntry[] = [];
  const seen = new Set<unknown>();

  let current: unknown = error;

  while (current !== null && current !== undefined && chain.length <= MAX_CAUSE_DEPTH) {
    if (seen.has(current)) {
      break;
    }

    seen.add(current);

    if (!(current instanceof Error)) {
      chain.push({ name: typeof current === 'string' ? 'Error' : 'UnknownError' });

      break;
    }

    chain.push({ name: current.name || current.constructor.name, stack: current.stack });
    current = current.cause;
  }

  return chain;
}

function joinStackTraces(chain: ErrorChainEntry[]): string | undefined {
  const frames = chain
    .map((entry, index) => (index === 0 ? entry.stack : `Caused by: ${entry.stack}`))
    .filter((frame): frame is string => typeof frame === 'string' && frame.length > 0);

  if (frames.length === 0) {
    return undefined;
  }

  return sanitizeStackTrace(frames.join('\n'));
}
