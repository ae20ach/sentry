import {useCallback, useEffect, useRef} from 'react';
import * as qs from 'query-string';

import {addErrorMessage, addSuccessMessage} from 'sentry/actionCreators/indicator';
import {openPipelineModal} from 'sentry/components/pipeline/modal';
import type {ProvidersByType} from 'sentry/components/pipeline/registry';
import {t} from 'sentry/locale';
import {ConfigStore} from 'sentry/stores/configStore';
import type {IntegrationProvider, IntegrationWithConfig} from 'sentry/types/integrations';
import type {Organization} from 'sentry/types/organization';
import {trackIntegrationAnalytics} from 'sentry/utils/integrationUtil';
import {useOrganization} from 'sentry/utils/useOrganization';
import {computeCenteredWindow} from 'sentry/utils/window/computeCenteredWindow';
import {usePostMessageCallback} from 'sentry/utils/window/usePostMessage';
import type {MessagingIntegrationAnalyticsView} from 'sentry/views/alerts/rules/issue/setupMessagingIntegrationButton';

export interface AddIntegrationParams {
  onInstall: (data: IntegrationWithConfig) => void;
  provider: IntegrationProvider;
  account?: string | null;
  analyticsParams?: {
    already_installed: boolean;
    view:
      | MessagingIntegrationAnalyticsView
      | 'integrations_directory_integration_detail'
      | 'integrations_directory'
      | 'onboarding'
      | 'project_creation'
      | 'seer_onboarding_github'
      | 'seer_onboarding_code_review'
      | 'test_analytics_onboarding'
      | 'test_analytics_org_selector';
  };
  modalParams?: Record<string, string>;
  urlParams?: Record<string, string>;
}

/**
 * Per-provider feature flags that gate the new API-driven pipeline setup flow.
 * When enabled for a provider, the integration setup uses the React pipeline
 * modal instead of the legacy Django view popup window.
 *
 * Keys are provider identifiers (constrained to registered pipeline providers
 * via `satisfies`), values are feature flag names without the `organizations:`
 * prefix.
 */
const API_PIPELINE_FEATURE_FLAGS = {
  bitbucket: 'integration-api-pipeline-bitbucket',
  github: 'integration-api-pipeline-github',
  gitlab: 'integration-api-pipeline-gitlab',
  slack: 'integration-api-pipeline-slack',
} as const satisfies Partial<Record<ProvidersByType['integration'], string>>;

type ApiPipelineProvider = keyof typeof API_PIPELINE_FEATURE_FLAGS;

function getApiPipelineProvider(
  organization: Organization,
  providerKey: string
): ApiPipelineProvider | null {
  if (!(providerKey in API_PIPELINE_FEATURE_FLAGS)) {
    return null;
  }
  const key = providerKey as ApiPipelineProvider;
  const flag = API_PIPELINE_FEATURE_FLAGS[key];
  if (!organization.features.includes(flag)) {
    return null;
  }
  return key;
}

// ---------------------------------------------------------------------------
// Legacy dialog strategy (uses PostMessageContext)
// ---------------------------------------------------------------------------

function useLegacyDialogStrategy() {
  const organization = useOrganization();
  const subscribe = usePostMessageCallback();
  const unsubscribeRef = useRef<() => void | null>(null);

  const startFlow = useCallback(
    ({
      provider,
      onInstall,
      account,
      analyticsParams,
      modalParams,
      urlParams,
    }: AddIntegrationParams) => {
      trackIntegrationAnalytics('integrations.installation_start', {
        integration: provider.key,
        integration_type: 'first_party',
        organization,
        ...analyticsParams,
      });

      const name = modalParams?.use_staging
        ? 'sentryAddStagingIntegration'
        : 'sentryAddIntegration';
      const {url, width, height} = provider.setupDialog;
      const {left, top} = computeCenteredWindow(width, height);

      let query: Record<string, string> = {...urlParams};
      if (account) {
        query.account = account;
      }
      if (modalParams) {
        query = {...query, ...modalParams};
      }

      const installUrl = `${url}?${qs.stringify(query)}`;
      const opts = `scrollbars=yes,width=${width},height=${height},top=${top},left=${left}`;

      let dialog = window.open(installUrl, name, opts);
      if (!dialog) {
        // Popup was blocked?
        return;
      }
      dialog?.focus();

      unsubscribeRef.current = subscribe((message: MessageEvent) => {
        const validOrigins = [
          ConfigStore.get('links').sentryUrl,
          ConfigStore.get('links').organizationUrl,
          document.location.origin,
        ];
        if (!validOrigins.includes(message.origin)) {
          return;
        }
        if (message.source !== dialog) {
          return;
        }

        const {success, data} = message.data;
        dialog = null;
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;

        if (!success) {
          addErrorMessage(data?.error ?? t('An unknown error occurred'));
          return;
        }
        if (!data) {
          return;
        }

        trackIntegrationAnalytics('integrations.installation_complete', {
          integration: provider.key,
          integration_type: 'first_party',
          organization,
          ...analyticsParams,
        });
        addSuccessMessage(t('%s added', provider.name));
        onInstall(data);
      });
    },
    [subscribe, organization]
  );

  useEffect(() => {
    return () => {
      // Unsubscribe if we unmount after having started the flow
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, []);

  return {startFlow};
}
// ---------------------------------------------------------------------------
// Public hook: selects between pipeline modal and legacy dialog
// ---------------------------------------------------------------------------

export function useAddIntegration() {
  const organization = useOrganization();
  const {startFlow: legacyStartFlow} = useLegacyDialogStrategy();

  const startFlow = useCallback(
    (params: AddIntegrationParams) => {
      const {provider, onInstall, analyticsParams} = params;
      const pipelineProvider = getApiPipelineProvider(organization, provider.key);

      if (pipelineProvider === null) {
        legacyStartFlow(params);
        return;
      }

      trackIntegrationAnalytics('integrations.installation_start', {
        integration: provider.key,
        integration_type: 'first_party',
        organization,
        ...analyticsParams,
      });
      openPipelineModal({
        type: 'integration',
        provider: pipelineProvider,
        onComplete: (data: IntegrationWithConfig) => {
          trackIntegrationAnalytics('integrations.installation_complete', {
            integration: provider.key,
            integration_type: 'first_party',
            organization,
            ...analyticsParams,
          });
          addSuccessMessage(t('%s added', provider.name));
          onInstall(data);
        },
      });
    },
    [legacyStartFlow, organization]
  );

  return {startFlow};
}
