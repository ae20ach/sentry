import {useCallback} from 'react';
import {css} from '@emotion/react';

import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import {closeModal} from 'sentry/actionCreators/modal';
import type {CMDKActionData} from 'sentry/components/commandPalette/ui/cmdk';
import type {CollectionTreeNode} from 'sentry/components/commandPalette/ui/collection';
import {CommandPalette} from 'sentry/components/commandPalette/ui/commandPalette';
import {GlobalCommandPaletteActions} from 'sentry/components/commandPalette/ui/commandPaletteGlobalActions';
import type {Theme} from 'sentry/utils/theme';
import {normalizeUrl} from 'sentry/utils/url/normalizeUrl';
import {useNavigate} from 'sentry/utils/useNavigate';

export default function CommandPaletteModal({Body}: ModalRenderProps) {
  const navigate = useNavigate();

  const handleSelect = useCallback(
    (action: CollectionTreeNode<CMDKActionData>) => {
      if ('to' in action) {
        navigate(normalizeUrl(String(action.to)));
      } else if ('onAction' in action) {
        action.onAction();
      }
      closeModal();
    },
    [navigate]
  );

  return (
    <Body>
      <CommandPalette onAction={handleSelect}>
        <GlobalCommandPaletteActions />
      </CommandPalette>
    </Body>
  );
}

export const modalCss = (theme: Theme) => {
  return css`
    [role='document'] {
      padding: 0;

      background-color: ${theme.tokens.background.primary};
      border-top-left-radius: calc(${theme.radius.lg} + 1px);
      border-top-right-radius: calc(${theme.radius.lg} + 1px);
    }
  `;
};
