import type {ReactNode} from 'react';

import {Heading} from '@sentry/scraps/text';

type Props = {
  children: ReactNode;
};

export function EditableAutomationTitle({children}: Props) {
  return (
    <Heading as="h1" ellipsis>
      {children}
    </Heading>
  );
}
