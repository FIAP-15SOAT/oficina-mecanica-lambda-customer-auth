import { maskScalar } from './pii-masker';

export const REDACTED = '[REDACTED]';
export const MAX_TEXT_LENGTH = 2048;
export const MAX_STACKTRACE_LENGTH = 8192;

interface NamedPattern {
  name: string;
  pattern: RegExp;
}

const SECRET_PATTERNS: readonly NamedPattern[] = [
  {
    name: 'jwt',
    pattern:
      /(?<![A-Za-z0-9_-])(?=([A-Za-z0-9_-]{10,}))\1\.(?=([A-Za-z0-9_-]{10,}))\2\.(?=([A-Za-z0-9_-]{10,}))\3/g,
  },
  {
    name: 'auth-scheme',
    pattern: /\b(?:Bearer|Basic|Digest|Token|ApiKey)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  },
  // URL com usuário:senha embutidos — o caso concreto é o DATABASE_URL
  // (`postgresql://user:senha@host/db`) aparecendo num erro do Prisma.
  //
  // A senha exclui `/`, `?` e `#` porque a RFC 3986 exige que eles venham
  // percent-encoded dentro do userinfo. Sem essa exclusão o quantificador
  // varria até o fim do texto procurando um `@` que não vinha, e um trecho como
  // `a://b:` repetido custava O(n²) — 12,6 ms em 8 KB. Com ela, o `://` do
  // próximo trecho encerra a varredura do anterior, e o custo vira linear.
  {
    name: 'url-credentials',
    pattern: /(?<![A-Za-z0-9+.-])[a-zA-Z](?=([a-zA-Z0-9+.-]*))\1:\/\/[^\s:/@]+:[^\s@/?#]+@\S+/g,
  },
  // Par chave=valor sensível em query string ou connection string.
  { name: 'key-value', pattern: /\b(?:password|pwd|secret|api[_-]?key)=[^;&\s]+/gi },
];

const PII_PATTERNS: readonly NamedPattern[] = [
  { name: 'cnpj-formatted', pattern: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g },
  { name: 'cpf-formatted', pattern: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g },
  { name: 'cnpj-digits', pattern: /\b\d{14}\b/g },
  { name: 'cpf-digits', pattern: /\b\d{11}\b/g },
  {
    name: 'email',
    pattern:
      /(?<![A-Za-z0-9._%+-])(?=([A-Za-z0-9._%+-]+))\1@(?=([A-Za-z0-9-]+))\2\.(?=([A-Za-z0-9.-]+))\3/g,
  },
  { name: 'phone-parenthesized', pattern: /\(\d{2}\)\s?\d{4,5}-\d{4}/g },
  { name: 'phone-spaced', pattern: /\b\d{2}\s\d{4,5}-\d{4}\b/g },
];

export function truncateText(value: string, maxLength: number = MAX_TEXT_LENGTH): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Varre texto livre atrás de conteúdo sensível que não foi capturado pelo nome do
 * campo — mensagem de exceção, stack trace, user-agent. Segredo é removido;
 * PII é mascarada preservando a forma.
 */
export function sanitizeText(value: string, maxLength: number = MAX_TEXT_LENGTH): string {
  const bounded = truncateText(value, maxLength);

  const withoutSecrets = SECRET_PATTERNS.reduce(
    (text, { pattern }) => text.replace(pattern, REDACTED),
    bounded,
  );

  return PII_PATTERNS.reduce(
    (text, { pattern }) => text.replace(pattern, (match) => maskScalar(match)),
    withoutSecrets,
  );
}

export function sanitizeStackTrace(value: string): string {
  return sanitizeText(value, MAX_STACKTRACE_LENGTH);
}
