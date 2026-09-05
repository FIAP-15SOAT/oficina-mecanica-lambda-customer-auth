import { LogicalFieldName } from '@application/logging/log-field';

export type FieldSensitivity = 'clear' | 'pii';

export const EVENT_NAME_FIELD = 'oficina.event.name';

interface LogicalFieldDefinition {
  key: string;
  sensitivity: FieldSensitivity;
}

export const LOGICAL_FIELDS: Readonly<Record<LogicalFieldName, LogicalFieldDefinition>> = {
  subjectId: { key: 'oficina.auth.subject.id', sensitivity: 'clear' },
  failureReason: { key: 'oficina.auth.failure.reason', sensitivity: 'clear' },
  maskedCpf: { key: 'oficina.auth.subject.cpf_masked', sensitivity: 'pii' },
};

export const DECLARED_FIELD_NAMES: ReadonlySet<string> = new Set([
  // Envelope
  'timestamp',
  'level',
  'message',
  // Serviço e ambiente
  'service.name',
  'service.namespace',
  'service.version',
  'deployment.environment.name',
  // Execução serverless e nuvem
  'faas.invocation_id',
  'faas.coldstart',
  'faas.name',
  'faas.version',
  'faas.instance',
  'faas.max_memory',
  'cloud.provider',
  'cloud.platform',
  'cloud.region',
  'cloud.resource_id',
  // Correlação
  'request.id',
  // Atendimento da invocação
  'http.request.method',
  'http.response.status_code',
  'oficina.faas.invocation.duration_ms',
  'oficina.db.query.duration_ms',
  'oficina.auth.password.verification.duration_ms',
  // Erro
  'error.type',
  'oficina.error.message',
  'exception.type',
  'exception.message',
  'exception.stacktrace',
  // Evento e campos de negócio
  EVENT_NAME_FIELD,
  ...Object.values(LOGICAL_FIELDS).map((definition) => definition.key),
]);

export function resolveLogicalField(logicalName: string): LogicalFieldDefinition | undefined {
  return LOGICAL_FIELDS[logicalName as LogicalFieldName];
}

export function isDeclaredField(name: string): boolean {
  return DECLARED_FIELD_NAMES.has(name);
}
