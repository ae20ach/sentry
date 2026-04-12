import type {ButtonProps} from '@sentry/scraps/button';
import {Button} from '@sentry/scraps/button';
import {Tooltip} from '@sentry/scraps/tooltip';

import {t} from 'sentry/locale';
import type {Organization} from 'sentry/types/organization';
import {trackAnalytics} from 'sentry/utils/analytics';
import type {AddIntegrationParams} from 'sentry/utils/integrations/useAddIntegration';
import {useAddIntegration} from 'sentry/utils/integrations/useAddIntegration';

interface AddIntegrationButtonProps
  extends
    Omit<ButtonProps, 'children' | 'analyticsParams'>,
    Pick<AddIntegrationParams, 'provider' | 'analyticsParams' | 'modalParams'> {
  onAddIntegration: AddIntegrationParams['onInstall'];
  organization: Organization;
  buttonText?: string;
  installStatus?: string;
  reinstall?: boolean;
}

export function AddIntegrationButton({
  provider,
  buttonText,
  onAddIntegration,
  organization,
  reinstall,
  analyticsParams,
  modalParams,
  installStatus,
  ...buttonProps
}: AddIntegrationButtonProps) {
  const label =
    buttonText ??
    (reinstall
      ? t('Enable')
      : installStatus === 'Disabled'
        ? t('Reinstall')
        : t('Add %s', provider.metadata.noun));

  const {startFlow} = useAddIntegration();

  return (
    <Tooltip
      disabled={provider.canAdd}
      title={`Integration cannot be added on Sentry. Enable this integration via the ${provider.name} instance.`}
    >
      <Button
        disabled={!provider.canAdd}
        {...buttonProps}
        onClick={() => {
          if (label === t('Reinstall')) {
            trackAnalytics('integrations.integration_reinstall_clicked', {
              organization,
              provider: provider.metadata.noun,
            });
          }
          startFlow({
            provider,
            onInstall: onAddIntegration,
            analyticsParams,
            modalParams,
          });
        }}
        aria-label={t('Add integration')}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
