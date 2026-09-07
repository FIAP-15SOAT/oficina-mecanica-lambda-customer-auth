import { z } from 'zod';

import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { LOG_LEVELS } from '@infrastructure/logging/logger.config';

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .or(z.boolean());

const positiveInteger = z.coerce.number().int().positive();

/**
 * Um PEM não sobrevive a uma variável de ambiente com as quebras de linha
 * intactas. A forma escapada é a única que `.env` e o descritor de contêiner
 * transportam, e restaurá-la aqui evita que cada consumidor invente a sua.
 */
const pem = z
  .string()
  .min(1)
  .transform((value) => value.replaceAll('\\n', '\n'));

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),

    DATABASE_HOST: z.string().min(1),
    DATABASE_PORT: positiveInteger.max(65535).default(5432),
    DATABASE_NAME: z.string().min(1),
    DATABASE_CONNECTION_TIMEOUT_MS: positiveInteger.default(3000),
    DATABASE_QUERY_TIMEOUT_MS: positiveInteger.default(5000),
    DATABASE_SSL: booleanFromString.default(true),
    DATABASE_SSL_CA: pem.optional(),

    DATABASE_SECRET_ID: z.string().min(1).optional(),
    DATABASE_SECRET: z.string().min(1).optional(),
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
        ? Boolean(value.DATABASE_SECRET_ID)
        : Boolean(value.DATABASE_SECRET_ID ?? value.DATABASE_SECRET),
    {
      path: ['DATABASE_SECRET_ID'],
      message:
        'em produção informe DATABASE_SECRET_ID; fora dela, ele ou o fallback DATABASE_SECRET',
    },
  )
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
  .refine((value) => value.NODE_ENV !== 'production' || !value.DATABASE_SECRET, {
    path: ['DATABASE_SECRET'],
    message: 'DATABASE_SECRET não é aceito em produção: use DATABASE_SECRET_ID',
  })
  .refine((value) => value.NODE_ENV !== 'production' || !value.CUSTOMER_JWT_PRIVATE_KEY, {
    path: ['CUSTOMER_JWT_PRIVATE_KEY'],
    message:
      'CUSTOMER_JWT_PRIVATE_KEY não é aceito em produção: use CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID',
  })
  .refine((value) => value.DATABASE_SSL || value.NODE_ENV !== 'production', {
    path: ['DATABASE_SSL'],
    message: 'DATABASE_SSL=false não é aceito em produção',
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
