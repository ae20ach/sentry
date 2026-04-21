import type {ParseResult} from 'sentry/components/searchSyntax/parser';
import type {FieldDefinition} from 'sentry/utils/fields';

export type FilterKeySection = {
  children: string[];
  label: React.ReactNode;
  value: string;
};

export enum QueryInterfaceType {
  TEXT = 'text',
  TOKENIZED = 'tokenized',
}

export type FocusOverride = {
  itemKey: string | 'end';
  part?: 'value' | 'key' | 'op';
};

export type FieldDefinitionGetter = (key: string) => FieldDefinition | null;

export type CallbackSearchState = {
  parsedQuery: ParseResult | null;
  queryIsValid: boolean;
};
