import type {SelectOptionWithKey} from '@sentry/scraps/compactSelect';

export type SuggestionItem = {
  value: string;
  description?: React.ReactNode;
  label?: React.ReactNode;
};

export type SuggestionSection = {
  sectionText: string;
  suggestions: SuggestionItem[];
};

export type SuggestionSectionItem = {
  items: Array<SelectOptionWithKey<string>>;
  sectionText: string;
};
