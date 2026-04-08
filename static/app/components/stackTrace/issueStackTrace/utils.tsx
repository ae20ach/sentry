import type {ExceptionValue} from 'sentry/types/event';
import type {StacktraceType} from 'sentry/types/stacktrace';

export interface IndexedExceptionValue extends ExceptionValue {
  exceptionIndex: number;
  stacktrace: StacktraceType;
}

/** Resolves symbolicated vs raw (minified) exception fields. */
export function resolveExceptionFields(exc: IndexedExceptionValue, isMinified: boolean) {
  return {
    type: isMinified ? (exc.rawType ?? exc.type) : exc.type,
    module: isMinified ? (exc.rawModule ?? exc.module) : exc.module,
    value: isMinified ? (exc.rawValue ?? exc.value) : exc.value,
  };
}
