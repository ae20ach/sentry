import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';

import {Flex} from '@sentry/scraps/layout';
import {Text} from '@sentry/scraps/text';
import {Tooltip} from '@sentry/scraps/tooltip';

import {DropdownMenu, type DropdownMenuProps} from 'sentry/components/dropdownMenu';
import {
  isSeerSupportedProvider,
  useSeerSupportedProviderIds,
} from 'sentry/components/events/autofix/utils';
import {RepoProviderIcon} from 'sentry/components/repositories/repoProviderIcon';
import {organizationConfigIntegrationsQueryOptions} from 'sentry/components/repositories/scmIntegrationTree/organizationConfigIntegrationsQueryOptions';
import {IconAdd} from 'sentry/icons/iconAdd';
import {IconInfo} from 'sentry/icons/iconInfo';
import {IconSeer} from 'sentry/icons/iconSeer';
import {t} from 'sentry/locale';
import * as Storybook from 'sentry/stories';
import type {IntegrationProvider} from 'sentry/types/integrations';
import {useOrganization} from 'sentry/utils/useOrganization';

const COMMON: DropdownMenuProps = {
  isOpen: true,
  position: 'bottom-start',
  size: 'sm',
  triggerLabel: t('Connect Source Code'),
  triggerProps: {
    size: 'sm',
    priority: 'primary',
    icon: <IconAdd />,
  },
  items: [],
};

function Wrapper({
  children,
}: {
  children: (props: {
    scmProviders: IntegrationProvider[];
    supportedProviderIds: string[];
  }) => React.ReactNode;
}) {
  const organization = useOrganization();
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

  return <Flex height="270px">{children({scmProviders, supportedProviderIds})}</Flex>;
}

export default Storybook.story('SCM Provider DropdownMenu', story => {
  story('Stars + InfoIcon', () => (
    <Wrapper>
      {({scmProviders, supportedProviderIds}) => (
        <DropdownMenu
          {...COMMON}
          items={
            scmProviders.map(provider => ({
              key: provider.key,
              label: [
                provider.name,
                isSeerSupportedProvider(
                  {id: provider.key, name: provider.name},
                  supportedProviderIds
                )
                  ? '*'
                  : '',
              ].join(''),
              leadingItems: (
                <Flex alignSelf="center">
                  <RepoProviderIcon provider={provider.key} />
                </Flex>
              ),
              onAction: () => {
                console.log('need to install integration for', provider.key);
              },
            })) ?? []
          }
          menuFooter={
            <Flex align="center" gap="xs" padding="md" borderTop="primary">
              <IconInfo size="xs" variant="muted" />
              <Text variant="muted" size="sm">
                *Only GitHub and GitLab work with Seer.
              </Text>
            </Flex>
          }
        />
      )}
    </Wrapper>
  ));

  story('Stars + IconSeer', () => (
    <Wrapper>
      {({scmProviders, supportedProviderIds}) => (
        <DropdownMenu
          {...COMMON}
          items={
            scmProviders.map(provider => ({
              key: provider.key,
              label: [
                provider.name,
                isSeerSupportedProvider(
                  {id: provider.key, name: provider.name},
                  supportedProviderIds
                )
                  ? '*'
                  : '',
              ].join(''),
              leadingItems: (
                <Flex alignSelf="center">
                  <RepoProviderIcon provider={provider.key} />
                </Flex>
              ),
              onAction: () => {
                console.log('need to install integration for', provider.key);
              },
            })) ?? []
          }
          menuFooter={
            <Flex align="center" gap="xs" padding="md" borderTop="primary">
              <IconSeer size="xs" variant="muted" />
              <Text variant="muted" size="sm">
                *Only GitHub and GitLab work with Seer.
              </Text>
            </Flex>
          }
        />
      )}
    </Wrapper>
  ));

  story('Seer Icon', () => (
    <Wrapper>
      {({scmProviders, supportedProviderIds}) => (
        <DropdownMenu
          {...COMMON}
          items={
            scmProviders.map(provider => ({
              key: provider.key,
              label: provider.name,
              leadingItems: (
                <Flex alignSelf="center">
                  <RepoProviderIcon provider={provider.key} />
                </Flex>
              ),
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
            <Flex align="center" gap="xs" padding="md" borderTop="primary">
              <IconSeer size="xs" variant="muted" />
              <Text variant="muted" size="sm">
                Supported by Sentry's Seer Agent
              </Text>
            </Flex>
          }
        />
      )}
    </Wrapper>
  ));
});
