import type {ReactNode} from 'react';
import styled from '@emotion/styled';

import {Heading} from '@sentry/scraps/text';

type Props = {
  children: ReactNode;
};

export function EditableAutomationTitle({children}: Props) {
  return (
    <StyledEditableAutomationTitle as="h1" ellipsis>
      {children}
    </StyledEditableAutomationTitle>
  );
}

const StyledEditableAutomationTitle = styled(Heading)`
  width: 100%;
  min-width: 0;
  font-size: 1.625rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 40px;
  display: flex;
  gap: ${p => p.theme.space.md};
  align-items: center;
`;
