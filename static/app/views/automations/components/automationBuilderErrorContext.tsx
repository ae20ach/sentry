import {createContext, useContext} from 'react';

import type {RequestError} from 'sentry/utils/requestError/requestError';

export const AutomationBuilderErrorContext = createContext<{
  errors: Record<string, any>;
  mutationErrors: RequestError['responseJSON'];
  removeError: (errorId: string) => void;
  setErrors: (errors: React.Dispatch<React.SetStateAction<Record<string, any>>>) => void;
} | null>(null);

export const useAutomationBuilderErrorContext = () => {
  const context = useContext(AutomationBuilderErrorContext);
  if (!context) {
    throw new Error(
      'useAutomationBuilderErrorContext was called outside of AutomationBuilder'
    );
  }
  return context;
};
