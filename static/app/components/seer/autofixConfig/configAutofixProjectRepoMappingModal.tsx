import {Fragment, useCallback, useMemo, useState} from 'react';
import styled from '@emotion/styled';
import uniqBy from 'lodash/uniqBy';

import {CompactSelect, type SelectOption} from '@sentry/scraps/compactSelect';
import {Stack} from '@sentry/scraps/layout';
import {ExternalLink} from '@sentry/scraps/link';
import {OverlayTrigger} from '@sentry/scraps/overlayTrigger';
import {Heading, Text} from '@sentry/scraps/text';

import {addErrorMessage} from 'sentry/actionCreators/indicator';
import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import {organizationRepositoriesInfiniteOptions} from 'sentry/components/events/autofix/preferences/hooks/useOrganizationRepositories';
import {PanelBody} from 'sentry/components/panels/panelBody';
import {PanelItem} from 'sentry/components/panels/panelItem';
import {IconAdd} from 'sentry/icons';
import {t, tct} from 'sentry/locale';
import type {RepositoryWithSettings} from 'sentry/types/integrations';
import {useFetchAllPages} from 'sentry/utils/api/apiFetch';
import {useInfiniteQuery} from 'sentry/utils/queryClient';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useProjects} from 'sentry/utils/useProjects';

import {RepositoryToProjectConfiguration} from './repositoryToProjectConfiguration';

interface Props extends ModalRenderProps {
  title: string;
}

export function ConfigAutofixProjectRepoMappingModal({Header, Body, title}: Props) {
  const organization = useOrganization();
  const {projects} = useProjects();

  const repositoriesResult = useInfiniteQuery({
    ...organizationRepositoriesInfiniteOptions({
      organization,
      query: {per_page: 100},
    }),
    select: ({pages}) =>
      uniqBy(
        pages.flatMap(page => page.json),
        'id'
      ) as RepositoryWithSettings[],
  });
  useFetchAllPages({result: repositoriesResult});
  const {data: repositories, isFetching: isRepositoriesFetching} = repositoriesResult;

  const repositoriesMap = useMemo(
    () => Object.fromEntries(repositories?.map(repo => [repo.id, repo]) ?? []),
    [repositories]
  );

  const [selectedRepositories, setSelectedRepositories] = useState<
    RepositoryWithSettings[]
  >([]);
  const [repositoryProjectMapping, setRepositoryProjectMapping] = useState<
    Record<string, string[]>
  >({});

  const selectedRepoIds = useMemo(
    () => new Set(selectedRepositories.map(repo => repo.id)),
    [selectedRepositories]
  );

  const availableRepositories = useMemo(
    () => repositories?.filter(repo => !selectedRepoIds.has(repo.id)) ?? [],
    [repositories, selectedRepoIds]
  );

  const repositoryOptions = useMemo(
    () =>
      availableRepositories.map(repo => ({
        value: repo.id,
        label: repo.name,
        textValue: repo.name,
      })),
    [availableRepositories]
  );

  const handleAddRepository = useCallback(
    (option: SelectOption<string>) => {
      const repo = repositoriesMap[option.value];
      if (!repo) {
        return;
      }
      setSelectedRepositories(prev => [...prev, repo]);
      setRepositoryProjectMapping(prev => ({...prev, [option.value]: []}));
    },
    [repositoriesMap]
  );

  const handleRemoveRepository = useCallback((repoId: string) => {
    setSelectedRepositories(prev => prev.filter(repo => repo.id !== repoId));
    setRepositoryProjectMapping(prev => {
      const next = {...prev};
      delete next[repoId];
      return next;
    });
  }, []);

  const handleChangeRepository = useCallback(
    (oldRepoId: string, newRepoId: string) => {
      const newRepo = repositoriesMap[newRepoId];
      if (!newRepo) {
        return;
      }
      setSelectedRepositories(prev =>
        prev.map(repo => (repo.id === oldRepoId ? newRepo : repo))
      );
      setRepositoryProjectMapping(prev => {
        const next = {...prev};
        delete next[oldRepoId];
        next[newRepoId] = [];
        return next;
      });
    },
    [repositoriesMap]
  );

  const handleChangeMapping = useCallback(
    (repoId: string, index: number, newValue: string | undefined) => {
      setRepositoryProjectMapping(prev => {
        const currentProjects = prev[repoId] || [];

        if (newValue && currentProjects.includes(newValue)) {
          addErrorMessage(t('Project is already mapped to this repo'));
          return prev;
        }

        const newProjects = [...currentProjects];
        if (newValue === undefined) {
          newProjects.splice(index, 1);
        } else if (index >= newProjects.length) {
          newProjects.push(newValue);
        } else {
          newProjects[index] = newValue;
        }

        return {...prev, [repoId]: newProjects};
      });
    },
    []
  );

  return (
    <Fragment>
      <Header closeButton>
        <Heading as="h4">{title}</Heading>
      </Header>
      <Body>
        <Stack gap="xl">
          <Text size="md">
            {tct(
              `Connect repositories to Sentry projects so Autofix can collect context and debug issues. [read_the_docs:Read the docs] and our [privacy:AI Privacy Principles] to learn more.`,
              {
                privacy: (
                  <ExternalLink href="https://docs.sentry.io/product/ai-in-sentry/ai-privacy-and-security/" />
                ),
                read_the_docs: (
                  <ExternalLink href="https://docs.sentry.io/product/ai-in-sentry/seer/#seer-capabilities" />
                ),
              }
            )}
          </Text>
          <PanelBody>
            <RepositoryToProjectConfiguration
              isPending={isRepositoriesFetching}
              projects={projects}
              repositories={repositories}
              selectedRootCauseAnalysisRepositories={selectedRepositories}
              repositoryProjectMapping={repositoryProjectMapping}
              onChange={handleChangeMapping}
              onChangeRepository={handleChangeRepository}
              onRemoveRepository={handleRemoveRepository}
            />
            {availableRepositories.length > 0 && (
              <AddRepoRow>
                <CompactSelect
                  size="sm"
                  search
                  value={undefined}
                  strategy="fixed"
                  trigger={triggerProps => (
                    <OverlayTrigger.Button {...triggerProps} icon={<IconAdd />}>
                      {t('Add Repository')}
                    </OverlayTrigger.Button>
                  )}
                  onChange={handleAddRepository}
                  options={repositoryOptions}
                  menuTitle={t('Select Repository')}
                />
              </AddRepoRow>
            )}
          </PanelBody>
        </Stack>
      </Body>
    </Fragment>
  );
}

const AddRepoRow = styled(PanelItem)`
  align-items: center;
  justify-content: flex-end;
`;
