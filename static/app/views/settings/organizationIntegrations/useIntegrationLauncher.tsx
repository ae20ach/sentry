import {useCallback, useEffect, useRef} from 'react';
import * as qs from 'query-string';

import {addErrorMessage, addSuccessMessage} from 'sentry/actionCreators/indicator';
import {openPipelineModal} from 'sentry/components/pipeline/modal';
import {t} from 'sentry/locale';
import {ConfigStore} from 'sentry/stores/configStore';
import type {IntegrationProvider, IntegrationWithConfig} from 'sentry/types/integrations';
import {trackIntegrationAnalytics} from 'sentry/utils/integrationUtil';

import type {AddIntegrationParams} from './addIntegration';
import {computeCenteredWindow, getApiPipelineProvider} from './addIntegration';

type UseIntegrationLauncherParams = Omit<
  AddIntegrationParams,
  'provider' | 'account' | 'modalParams'
>;

/**
 * Launches integration install flows for any provider passed at call time.
 *
 * Unlike {@link useAddIntegration}, which binds to a single provider at hook
 * initialization, this hook accepts the provider as an argument to `startFlow`.
 * This makes it suitable for data-driven UIs (dropdowns, menus) that need to
 * launch flows for multiple providers from a single hook instance.
 *
 * Only one legacy popup flow can be active at a time. Starting a new flow
 * while one is pending will replace the active provider context.
 */
export function useIntegrationLauncher({
  organization,
  onInstall,
  analyticsParams,
}: UseIntegrationLauncherParams) {
  const dialogRef = useRef<Window | null>(null);
  const activeProviderRef = useRef<IntegrationProvider | null>(null);
  const onInstallRef = useRef(onInstall);
  onInstallRef.current = onInstall;
  const analyticsParamsRef = useRef(analyticsParams);
  analyticsParamsRef.current = analyticsParams;

  useEffect(() => {
    function handleMessage(message: MessageEvent) {
      const validOrigins = [
        ConfigStore.get('links').sentryUrl,
        ConfigStore.get('links').organizationUrl,
        document.location.origin,
      ];
      if (!validOrigins.includes(message.origin)) {
        return;
      }
      if (message.source !== dialogRef.current) {
        return;
      }

      const {success, data} = message.data;
      dialogRef.current = null;
      const provider = activeProviderRef.current;
      activeProviderRef.current = null;

      if (!success) {
        addErrorMessage(data?.error ?? t('An unknown error occurred'));
        return;
      }
      if (!data || !provider) {
        return;
      }

      trackIntegrationAnalytics('integrations.installation_complete', {
        integration: provider.key,
        integration_type: 'first_party',
        organization,
        ...analyticsParamsRef.current,
      });
      addSuccessMessage(t('%s added', provider.name));
      onInstallRef.current(data);
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      dialogRef.current?.close();
    };
  }, [organization]);

  const startFlow = useCallback(
    (provider: IntegrationProvider, urlParams?: Record<string, string>) => {
      trackIntegrationAnalytics('integrations.installation_start', {
        integration: provider.key,
        integration_type: 'first_party',
        organization,
        ...analyticsParams,
      });

      const pipelineProvider = getApiPipelineProvider(organization, provider.key);
      if (pipelineProvider !== null) {
        openPipelineModal({
          type: 'integration',
          provider: pipelineProvider,
          onComplete: (data: IntegrationWithConfig) => {
            trackIntegrationAnalytics('integrations.installation_complete', {
              integration: provider.key,
              integration_type: 'first_party',
              organization,
              ...analyticsParamsRef.current,
            });
            addSuccessMessage(t('%s added', provider.name));
            onInstallRef.current(data);
          },
        });
        return;
      }

      // Legacy popup flow
      const {url, width, height} = provider.setupDialog;
      const {left, top} = computeCenteredWindow(width, height);
      const installUrl = `${url}?${qs.stringify(urlParams ?? {})}`;
      const opts = `scrollbars=yes,width=${width},height=${height},top=${top},left=${left}`;

      activeProviderRef.current = provider;
      dialogRef.current = window.open(installUrl, 'sentryAddIntegration', opts);
      dialogRef.current?.focus();
    },
    [organization, analyticsParams]
  );

  return {startFlow};
}
