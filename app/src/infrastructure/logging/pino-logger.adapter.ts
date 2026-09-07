import { Logger } from 'pino';

import { LogEventDefinition, LogLevelName } from '@application/logging/log-event';
import { LogFields } from '@application/logging/log-field';
import { ILogger, NoExtraFields } from '@application/ports/output/logger.service.interface';

import { describeError } from './error-serializer';
import { EVENT_NAME_FIELD, resolveLogicalField } from './field-registry';
import { reportLoggingFailure, runSafelyVoid } from './logging-diagnostics';
import { maskScalar } from './redaction/pii-masker';
import { sanitizeText } from './redaction/text-sanitizer';

export class PinoLoggerAdapter implements ILogger {
  constructor(
    private readonly pinoLogger: Logger,
    private readonly attributes: Record<string, unknown> = {},
  ) {}

  forInvocation(attributes: Record<string, unknown>): PinoLoggerAdapter {
    return new PinoLoggerAdapter(this.pinoLogger, attributes);
  }

  error(message: string, error?: unknown): void {
    this.emit('error', message, () => (error === undefined ? {} : describeError(error)));
  }

  event<TFields extends LogFields, TGiven extends TFields>(
    definition: LogEventDefinition<TFields>,
    fields: NoExtraFields<TFields, TGiven>,
    error?: unknown,
  ): void {
    this.emit(definition.level, definition.message, () => ({
      [EVENT_NAME_FIELD]: definition.name,
      ...(error === undefined ? {} : describeError(error)),
      ...mapFields(fields),
    }));
  }

  /** Linha do atendimento da invocação: nível derivado do status da resposta. */
  emitRecord(level: LogLevelName, message: string, record: Record<string, unknown>): void {
    this.emit(level, message, () => record);
  }

  private emit(
    level: LogLevelName,
    message: string,
    buildRecord: () => Record<string, unknown>,
  ): void {
    runSafelyVoid('emit', () => {
      this.pinoLogger[level]({ ...this.attributes, ...buildRecord() }, message);
    });
  }
}

function mapFields(fields: LogFields): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [logicalName, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }

    const definition = resolveLogicalField(logicalName);

    if (!definition) {
      reportLoggingFailure('emit', { field: logicalName });

      continue;
    }

    mapped[definition.key] =
      definition.sensitivity === 'pii' ? maskScalar(value) : sanitizeValue(value);
  }

  return mapped;
}

function sanitizeValue(value: unknown): unknown {
  return typeof value === 'string' ? sanitizeText(value) : value;
}
