import type {ReactNode} from 'react';
import {css} from '@emotion/react';

import {Flex} from '@sentry/scraps/layout';
import {Heading} from '@sentry/scraps/text';

type Props = {
  children: ReactNode;
};

export function EditableAutomationTitle({children}: Props) {
  return (
    <Heading ellipsis>
      {({className}) => (
        <Flex
          as="h1"
          className={className}
          align="center"
          gap="md"
          minWidth={0}
          width="100%"
          css={editableAutomationTitleCss}
        >
          {children}
        </Flex>
      )}
    </Heading>
  );
}

const editableAutomationTitleCss = css`
  width: 100%;
  font-size: 1.625rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 40px;
`;
