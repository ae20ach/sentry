import styled from '@emotion/styled';

import {NumberInput} from '@sentry/scraps/input';

export function AutomationBuilderNumberInput(
  props: React.ComponentProps<typeof NumberInput>
) {
  return <InlineNumberInput min={0} {...props} />;
}

const InlineNumberInput = styled(NumberInput)`
  width: 90px;
  height: 28px;
  min-height: 28px;
`;
