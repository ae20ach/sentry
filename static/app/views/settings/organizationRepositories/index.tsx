import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';

import {Flex, Stack} from '@sentry/scraps/layout';
import {ExternalLink} from '@sentry/scraps/link';

import {hasEveryAccess} from 'sentry/components/acl/access';
import {AnalyticsArea} from 'sentry/components/analyticsArea';
import {DropdownMenu} from 'sentry/components/dropdownMenu';
import {RepoProviderIcon} from 'sentry/components/repositories/repoProviderIcon';
import {organizationConfigIntegrationsQueryOptions} from 'sentry/components/repositories/scmIntegrationTree/organizationConfigIntegrationsQueryOptions';
import {ScmIntegrationTree} from 'sentry/components/repositories/scmIntegrationTree/scmIntegrationTree';
import {ScmTreeFilters} from 'sentry/components/repositories/scmIntegrationTree/scmTreeFilters';
import {useScmTreeFilters} from 'sentry/components/repositories/scmIntegrationTree/useScmTreeFilters';
import {SentryDocumentTitle} from 'sentry/components/sentryDocumentTitle';
import {IconAdd} from 'sentry/icons/iconAdd';
import {t, tct} from 'sentry/locale';
import {isActiveSuperuser} from 'sentry/utils/isActiveSuperuser';
import {useOrganization} from 'sentry/utils/useOrganization';
import {SettingsPageHeader} from 'sentry/views/settings/components/settingsPageHeader';

export default function OrganizationRepositories() {
  const organization = useOrganization();
  const canAccess =
    hasEveryAccess(['org:integrations'], {organization}) || isActiveSuperuser();

  const providersQuery = useQuery(
    organizationConfigIntegrationsQueryOptions({organization})
  );

  const scmProviders = useMemo(
    () =>
      (providersQuery.data?.providers ?? [])
        .filter(p => p.metadata.features.some(f => f.featureGate.includes('commits')))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [providersQuery.data]
  );

  // const {startFlow} = useAddIntegration({
  //   provider,
  //   organization,
  //   onInstall: onAddIntegration,
  //   analyticsParams,
  //   modalParams,
  // });

  const {repoFilter, setRepoFilter, searchTerm, setSearchTerm} = useScmTreeFilters();

  return (
    <AnalyticsArea name="repositories">
      <SentryDocumentTitle title={t('Repositories')} orgSlug={organization.slug} />
      <SettingsPageHeader
        title={t('Repositories')}
        action={
          organization.features.includes('scm-trimmed-tree') ? (
            <DropdownMenu
              size="sm"
              triggerLabel={t('Connect Source Code')}
              triggerProps={{
                size: 'sm',
                priority: 'primary',
                icon: <IconAdd />,
                disabled: !canAccess,
              }}
              items={
                scmProviders.map(provider => ({
                  key: provider.key,
                  label: provider.name,
                  leadingItems: <RepoProviderIcon provider={provider.key} size="sm" />,
                  onAction: () => {
                    console.log('need to install integration for', provider.key);
                  },
                })) ?? []
              }
            />
          ) : null
        }
        subtitle={tct(
          'Integrate with a [scm:Source Code Management] provider and then connect repositories with Sentry. Connecting a repo to a project enables [suspect_commits:Suspect Commits] on issues, [suggested_assignees:Suggested Assignees] based on code owners, the ability to mark an issue [resolved_via_commit:Resolved via Commit or PR], and is a requirement for [seer:Seer].',
          {
            scm: (
              <ExternalLink href="https://docs.sentry.io/organization/getting-started/#source-code-management" />
            ),
            suspect_commits: (
              <ExternalLink href="https://docs.sentry.io/product/issues/suspect-commits/" />
            ),
            suggested_assignees: (
              <ExternalLink href="https://docs.sentry.io/product/issues/ownership-rules/#code-owners" />
            ),
            resolved_via_commit: (
              <ExternalLink href="https://docs.sentry.io/product/releases/associate-commits/#associate-commits-with-a-release" />
            ),
            seer: (
              <ExternalLink href="https://docs.sentry.io/product/ai-in-sentry/seer/#seer-capabilities" />
            ),
          }
        )}
      />
      <Stack gap="lg">
        <Flex align="center" gap="md">
          <ScmTreeFilters
            repoFilter={repoFilter}
            setRepoFilter={setRepoFilter}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
          />
        </Flex>
        <ScmIntegrationTree
          providerFilter="all"
          repoFilter={repoFilter}
          search={searchTerm}
          showEmptyProviders={!organization.features.includes('scm-trimmed-tree')}
        />
      </Stack>
    </AnalyticsArea>
  );
}
