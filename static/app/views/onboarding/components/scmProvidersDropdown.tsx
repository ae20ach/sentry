import {DropdownMenu} from 'sentry/components/dropdownMenu';
import {t} from 'sentry/locale';
import type {Integration, IntegrationProvider} from 'sentry/types/integrations';
import {getIntegrationIcon} from 'sentry/utils/integrationUtil';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useIntegrationLauncher} from 'sentry/views/settings/organizationIntegrations/useIntegrationLauncher';

interface ScmProvidersDropdownProps {
  onInstall: (data: Integration) => void;
  providers: IntegrationProvider[];
}

/**
 * Renders secondary SCM providers (Bitbucket Server, GitHub Enterprise, Azure
 * DevOps, etc.) inside a dropdown menu. Uses {@link useIntegrationLauncher} to
 * launch the correct OAuth/pipeline flow for whichever provider the user picks.
 */
export function ScmProvidersDropdown({providers, onInstall}: ScmProvidersDropdownProps) {
  const organization = useOrganization();
  const {startFlow} = useIntegrationLauncher({
    organization,
    onInstall,
    analyticsParams: {
      view: 'onboarding',
      already_installed: false,
    },
  });

  return (
    <DropdownMenu
      triggerLabel={t('More')}
      position="bottom-end"
      items={providers.map(provider => ({
        key: provider.key,
        label: provider.name,
        leadingItems: getIntegrationIcon(provider.key, 'sm'),
        onAction: () => startFlow(provider),
      }))}
    />
  );
}
