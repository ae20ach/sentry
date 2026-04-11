import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';

import {Button, ButtonBar} from '@sentry/scraps/button';
import {Container, Flex, Stack} from '@sentry/scraps/layout';
import {ExternalLink} from '@sentry/scraps/link';
import {SegmentedControl} from '@sentry/scraps/segmentedControl';
import {Text} from '@sentry/scraps/text';
import {Tooltip} from '@sentry/scraps/tooltip';

import {hasEveryAccess} from 'sentry/components/acl/access';
import {AnalyticsArea} from 'sentry/components/analyticsArea';
import {DropdownButton} from 'sentry/components/dropdownButton';
import {DropdownMenu} from 'sentry/components/dropdownMenu';
import {EmptyMessage} from 'sentry/components/emptyMessage';
import {
  isSeerSupportedProvider,
  useSeerSupportedProviderIds,
} from 'sentry/components/events/autofix/utils';
import {RepoProviderIcon} from 'sentry/components/repositories/repoProviderIcon';
import {organizationConfigIntegrationsQueryOptions} from 'sentry/components/repositories/scmIntegrationTree/organizationConfigIntegrationsQueryOptions';
import {ScmIntegrationTree} from 'sentry/components/repositories/scmIntegrationTree/scmIntegrationTree';
import {ScmTreeFilters} from 'sentry/components/repositories/scmIntegrationTree/scmTreeFilters';
import {useScmTreeFilters} from 'sentry/components/repositories/scmIntegrationTree/useScmTreeFilters';
import {SentryDocumentTitle} from 'sentry/components/sentryDocumentTitle';
import {IconAdd} from 'sentry/icons/iconAdd';
import {IconBitbucket} from 'sentry/icons/iconBitbucket';
import {IconChevron} from 'sentry/icons/iconChevron';
import {IconGithub} from 'sentry/icons/iconGithub';
import {IconGitlab} from 'sentry/icons/iconGitlab';
import {IconInfo} from 'sentry/icons/iconInfo';
import {IconSeer} from 'sentry/icons/iconSeer';
import {IconVsts} from 'sentry/icons/iconVsts';
import {t, tct} from 'sentry/locale';
import {isActiveSuperuser} from 'sentry/utils/isActiveSuperuser';
import {useOrganization} from 'sentry/utils/useOrganization';
import {SettingsPageHeader} from 'sentry/views/settings/components/settingsPageHeader';

export default function OrganizationRepositories() {
  const organization = useOrganization();
  const canAccess =
    hasEveryAccess(['org:integrations'], {organization}) || isActiveSuperuser();

  const supportedProviderIds = useSeerSupportedProviderIds();
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

  // console.log({scmProviders});
  // const {startFlow} = useAddIntegration({
  //   provider,
  //   organization,
  //   onInstall: onAddIntegration,
  //   analyticsParams,
  //   modalParams,
  // });

  const hasProviders = scmProviders.length > 0;
  const {repoFilter, setRepoFilter, searchTerm, setSearchTerm} = useScmTreeFilters();

  return (
    <AnalyticsArea name="repositories">
      <SentryDocumentTitle title={t('Repositories')} orgSlug={organization.slug} />
      <SettingsPageHeader
        title={t('Repositories')}
        action={
          organization.features.includes('scm-trimmed-tree') && hasProviders ? (
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
                  trailingItems: isSeerSupportedProvider(
                    {id: provider.key, name: provider.name},
                    supportedProviderIds
                  ) ? (
                    <Tooltip title={t('Supported by Seer')}>
                      <IconSeer size="xs" variant="muted" />
                    </Tooltip>
                  ) : null,
                  onAction: () => {
                    console.log('need to install integration for', provider.key);
                  },
                })) ?? []
              }
              menuFooter={
                <Flex align="center" gap="xs" padding="md">
                  <IconSeer size="xs" variant="muted" />
                  <Text variant="muted" size="sm">
                    Supported by Sentry's Seer Agent
                  </Text>
                </Flex>
              }
            />
          ) : null
        }
        subtitle={
          hasProviders
            ? tct(
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
              )
            : null
        }
      />
      {hasProviders ? (
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
      ) : (
        <Container border="secondary" radius="xl" padding="3xl">
          <Stack gap="2xl" maxWidth="668px" justifySelf="center" padding="xl 0">
            <Text align="center">
              {tct(
                'Connect your source code providers, manage repositories, and configure code mappings to enable [suspect:Suspect Commits], [suggested:Suggested Assignees], and [seer:Seer].',
                {
                  suspect: (
                    <ExternalLink href="https://docs.sentry.io/product/issues/suspect-commits/" />
                  ),
                  suggested: (
                    <ExternalLink href="https://docs.sentry.io/product/issues/ownership-rules/#code-owners" />
                  ),
                  seer: (
                    <ExternalLink href="https://docs.sentry.io/product/ai-in-sentry/seer/#seer-capabilities" />
                  ),
                }
              )}
            </Text>

            <Flex align="center" gap="md" justify="center">
              {scmProviders.some(provider =>
                ['github', 'github_enterprise'].includes(provider.key)
              ) && (
                <ButtonBar>
                  <Button
                    size="sm"
                    icon={<IconGithub />}
                    onClick={() => {
                      console.log('need to install integration for', 'github');
                    }}
                  >
                    GitHub
                  </Button>
                  <DropdownMenu
                    size="sm"
                    trigger={(triggerProps, isOpen) => (
                      <Button
                        {...triggerProps}
                        aria-label={t('More options')}
                        size="sm"
                        icon={
                          <IconChevron
                            variant="muted"
                            direction={isOpen ? 'up' : 'down'}
                            size="xs"
                          />
                        }
                        disabled={!canAccess}
                      />
                    )}
                    items={
                      scmProviders
                        .filter(provider => provider.key === 'github_enterprise')
                        .map(provider => ({
                          key: provider.key,
                          label: provider.name,
                          onAction: () => {
                            console.log('need to install integration for', provider.key);
                          },
                        })) ?? []
                    }
                  />
                </ButtonBar>
              )}
              {scmProviders.some(provider => provider.key === 'gitlab') && (
                <Button
                  size="sm"
                  icon={<IconGitlab />}
                  onClick={() => {
                    console.log('need to install integration for', 'gitlab');
                  }}
                >
                  {t('GitLab')}
                </Button>
              )}
              {scmProviders.some(provider =>
                ['bitbucket', 'bitbucket_server'].includes(provider.key)
              ) && (
                <ButtonBar>
                  <Button
                    size="sm"
                    icon={<IconBitbucket />}
                    onClick={() => {
                      console.log('need to install integration for', 'bitbucket');
                    }}
                  >
                    Bitbucket
                  </Button>
                  <DropdownMenu
                    size="sm"
                    trigger={(triggerProps, isOpen) => (
                      <Button
                        {...triggerProps}
                        aria-label={t('More options')}
                        size="sm"
                        icon={
                          <IconChevron
                            variant="muted"
                            direction={isOpen ? 'up' : 'down'}
                            size="xs"
                          />
                        }
                        disabled={!canAccess}
                      />
                    )}
                    items={
                      scmProviders
                        .filter(provider => provider.key === 'bitbucket_server')
                        .map(provider => ({
                          key: provider.key,
                          label: provider.name,
                          onAction: () => {
                            console.log('need to install integration for', provider.key);
                          },
                        })) ?? []
                    }
                  />
                </ButtonBar>
              )}
              {scmProviders.some(provider => provider.key === 'vsts') && (
                <Button
                  size="sm"
                  icon={<IconVsts />}
                  onClick={() => {
                    console.log('need to install integration for', 'vsts');
                  }}
                >
                  {t('Azure')}
                </Button>
              )}
            </Flex>
          </Stack>
        </Container>
      )}
    </AnalyticsArea>
  );
}
