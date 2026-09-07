export const MASK = '***';

const REVEALED_EDGE_LENGTH = 2;

const MIN_TWO_EDGE_LENGTH = 7;
const MIN_SINGLE_EDGE_LENGTH = 4;

const MAX_REVEALED_IDENTIFIER_CHARS = 5;

const ALPHANUMERIC_RUN = /[\p{L}\p{N}]+/gu;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function maskScalar(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value);

  if (text.length === 0) {
    return text;
  }

  if (EMAIL_SHAPE.test(text)) {
    return maskEmail(text);
  }

  if (isFormattedIdentifier(text)) {
    return maskFormattedIdentifier(text);
  }

  return maskFreeText(text);
}

function maskEmail(value: string): string {
  const separator = value.lastIndexOf('@');

  return `${maskFreeText(value.slice(0, separator))}${value.slice(separator)}`;
}

function maskFreeText(value: string): string {
  if (value.length < MIN_SINGLE_EDGE_LENGTH) {
    return MASK;
  }

  if (value.length < MIN_TWO_EDGE_LENGTH) {
    return `${value.slice(0, 1)}${MASK}`;
  }

  return `${value.slice(0, REVEALED_EDGE_LENGTH)}${MASK}${value.slice(-REVEALED_EDGE_LENGTH)}`;
}

/**
 * Um identificador formatado é um valor composto só de blocos numéricos
 * separados por pontuação — CPF, CNPJ, CEP, telefone. Mascará-lo com a regra de
 * texto livre (`12***09`) destruiria a forma e ninguém reconheceria mais o que
 * o campo era.
 */
function isFormattedIdentifier(value: string): boolean {
  const runs = findAlphanumericRuns(value);

  return runs.length >= 2 && runs.every((run) => /^\p{N}+$/u.test(run[0]));
}

function maskFormattedIdentifier(value: string): string {
  const runs = findAlphanumericRuns(value);
  const visible = resolveVisibleRuns(runs);
  const characters = [...value];

  runs.forEach((run, index) => {
    if (visible.has(index)) {
      return;
    }

    for (let offset = 0; offset < run[0].length; offset += 1) {
      characters[run.index + offset] = '*';
    }
  });

  return characters.join('');
}

/**
 * O último bloco sempre aparece. O penúltimo só entra junto quando os dois somam
 * até 5 caracteres — é o que produz `***.***.789-09` no CPF (3 + 2) sem revelar
 * demais em um telefone, onde o penúltimo bloco já tem 5 dígitos sozinho.
 */
function resolveVisibleRuns(runs: RegExpExecArray[]): Set<number> {
  const lastIndex = runs.length - 1;
  const visible = new Set<number>([lastIndex]);

  const combined = runs[lastIndex][0].length + runs[lastIndex - 1][0].length;

  if (combined <= MAX_REVEALED_IDENTIFIER_CHARS) {
    visible.add(lastIndex - 1);
  }

  return visible;
}

function findAlphanumericRuns(value: string): RegExpExecArray[] {
  ALPHANUMERIC_RUN.lastIndex = 0;

  const runs: RegExpExecArray[] = [];
  let match = ALPHANUMERIC_RUN.exec(value);

  while (match !== null) {
    runs.push(match);
    match = ALPHANUMERIC_RUN.exec(value);
  }

  return runs;
}
