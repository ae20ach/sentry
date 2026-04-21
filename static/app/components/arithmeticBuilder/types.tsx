import type {FieldKind} from 'sentry/utils/fields';

export interface FunctionArgument {
  kind: FieldKind;
  name: string;
  label?: React.ReactNode;
}
