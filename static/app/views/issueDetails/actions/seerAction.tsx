import {Fragment} from 'react';
import {useQuery} from '@tanstack/react-query';

import {addLoadingMessage} from 'sentry/actionCreators/indicator';
import {CMDKAction} from 'sentry/components/commandPalette/ui/cmdk';
import {AutofixStatus, AutofixStepType} from 'sentry/components/events/autofix/types';
import {
  makeAutofixQueryKey,
  organizationIntegrationsCodingAgents,
  useAutofixData,
  useLaunchCodingAgent,
  type CodingAgentIntegration,
} from 'sentry/components/events/autofix/useAutofix';
import {getAutofixRunExists} from 'sentry/components/events/autofix/utils';
import {IconSeer} from 'sentry/icons';
import {t} from 'sentry/locale';
import type {Event} from 'sentry/types/event';
import type {Group} from 'sentry/types/group';
import type {Project} from 'sentry/types/project';
import {useQueryClient} from 'sentry/utils/queryClient';
import {useApi} from 'sentry/utils/useApi';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useAiConfig} from 'sentry/views/issueDetails/streamline/hooks/useAiConfig';
import {useOpenSeerDrawer} from 'sentry/views/issueDetails/streamline/sidebar/seerDrawer';

interface SeerCommandPaletteActionProps {
  event: Event | null;
  group: Group;
  project: Project;
}

export function SeerCommandPaletteAction({
  group,
  project,
  event,
}: SeerCommandPaletteActionProps) {
  const aiConfig = useAiConfig(group, project);
  const {data: autofixData} = useAutofixData({groupId: group.id});
  const {openSeerDrawer} = useOpenSeerDrawer({group, project, event});
  const api = useApi();
  const organization = useOrganization();
  const queryClient = useQueryClient();

  const rootCauseStep = autofixData?.steps?.find(
    s => s.type === AutofixStepType.ROOT_CAUSE_ANALYSIS
  );
  const rootCauseComplete = rootCauseStep?.status === AutofixStatus.COMPLETED;
  const runId = autofixData?.run_id ?? '';

  const {mutate: launchCodingAgent} = useLaunchCodingAgent(group.id, runId);

  const {data: codingAgentsData} = useQuery({
    ...organizationIntegrationsCodingAgents(organization),
    enabled: rootCauseComplete && aiConfig.hasAutofix,
  });
  const codingAgents = codingAgentsData?.integrations ?? [];

  if (!aiConfig.hasAutofix || !event) {
    return null;
  }

  const runExists = getAutofixRunExists(group);
  const isProcessing =
    autofixData?.status === AutofixStatus.PROCESSING ||
    autofixData?.steps?.some(s => s.status === AutofixStatus.PROCESSING);

  const triggerAndOpen = async () => {
    openSeerDrawer();
    try {
      await api.requestPromise(
        `/organizations/${organization.slug}/issues/${group.id}/autofix/`,
        {
          method: 'POST',
          query: {mode: 'legacy'},
          data: {event_id: event.id, instruction: ''},
        }
      );
    } finally {
      queryClient.invalidateQueries({
        queryKey: makeAutofixQueryKey(organization.slug, group.id, true),
      });
    }
  };

  const handleSendToAgent = (agent: CodingAgentIntegration) => {
    if (agent.requires_identity && !agent.has_identity) {
      window.location.href = `/remote/github-copilot/oauth/?next=${encodeURIComponent(window.location.href)}`;
      return;
    }
    addLoadingMessage(t('Launching %s\u2026', agent.name), {duration: 60000});
    launchCodingAgent({
      integrationId: agent.id,
      provider: agent.provider,
      agentName: agent.name,
      triggerSource: 'root_cause',
    });
  };

  // No run started yet
  if (!runExists) {
    return (
      <CMDKAction
        display={{label: t('Find root cause'), icon: <IconSeer />}}
        onAction={triggerAndOpen}
      />
    );
  }

  // Processing or awaiting initial data from a run that exists
  if (!autofixData || isProcessing) {
    return (
      <CMDKAction
        display={{label: t('Open Seer'), icon: <IconSeer />}}
        onAction={openSeerDrawer}
      />
    );
  }

  // Root cause complete — offer to send directly to a coding agent
  if (rootCauseComplete && codingAgents.length > 0) {
    return (
      <Fragment>
        <CMDKAction
          display={{label: t('Open Seer'), icon: <IconSeer />}}
          onAction={openSeerDrawer}
        />
        <CMDKAction display={{label: t('Send to agent'), icon: <IconSeer />}}>
          {codingAgents.map(agent => (
            <CMDKAction
              key={agent.id ?? agent.provider}
              display={{label: agent.name}}
              onAction={() => handleSendToAgent(agent)}
            />
          ))}
        </CMDKAction>
      </Fragment>
    );
  }

  return (
    <CMDKAction
      display={{label: t('Open Seer'), icon: <IconSeer />}}
      onAction={openSeerDrawer}
    />
  );
}
