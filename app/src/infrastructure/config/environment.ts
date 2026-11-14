import { z } from 'zod';

import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { LOG_LEVELS } from '@infrastructure/logging/logger.config';

const positiveInteger = z.coerce.number().int().positive();

/**
 * Um PEM não sobrevive a uma variável de ambiente com as quebras de linha
 * intactas. A forma escapada é a única que `.env` e o descritor de contêiner
 * transportam, e restaurá-la aqui evita que cada consumidor invente a sua.
 */
const pem = z
  .string()
  .min(1)
  .transform((value) => value.replaceAll(String.raw`\n`, '\n'));

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),

    IDENTITY_INTERNAL_URL: z.url({ protocol: /^https?$/ }),
    WORK_ORDER_INTERNAL_URL: z.url({ protocol: /^https?$/ }),

    CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID: z.string().min(1).optional(),
    CUSTOMER_JWT_PRIVATE_KEY: pem.optional(),

    CUSTOMER_JWT_ISSUER: z.string().min(1).default('oficina-customer-auth'),
    CUSTOMER_JWT_AUDIENCE: z.string().min(1).default('oficina-api'),
    CUSTOMER_JWT_TTL_SECONDS: positiveInteger.default(3600),
    CUSTOMER_JWT_KEY_ID: z.string().min(1).default('customer-auth'),
  })
  .refine(
    (value) =>
      value.NODE_ENV === 'production'
        ? Boolean(value.CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID)
        : Boolean(value.CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID ?? value.CUSTOMER_JWT_PRIVATE_KEY),
    {
      path: ['CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID'],
      message:
        'em produção informe CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID; fora dela, ele ou o fallback CUSTOMER_JWT_PRIVATE_KEY',
    },
  )
  .refine((value) => value.NODE_ENV !== 'production' || !value.CUSTOMER_JWT_PRIVATE_KEY, {
    path: ['CUSTOMER_JWT_PRIVATE_KEY'],
    message:
      'CUSTOMER_JWT_PRIVATE_KEY não é aceito em produção: use CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID',
  });

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    throw new ConfigurationException(
      `Configuração inválida: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '(raiz)'} — ${issue.message}`)
        .join('; ')}`,
    );
  }

  return result.data;
}
