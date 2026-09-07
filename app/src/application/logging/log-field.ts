export type LogicalFieldName = 'subjectId' | 'failureReason' | 'maskedCpf';

export type LogFields = Partial<Record<LogicalFieldName, unknown>>;
