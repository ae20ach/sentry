import {RepositoryToProjectConfiguration as AppRepositoryToProjectConfiguration} from 'sentry/components/seer/autofixConfig/repositoryToProjectConfiguration';
import type {Project} from 'sentry/types/project';

import {useSeerOnboardingContext} from './hooks/seerOnboardingContext';

interface RepositoryToProjectConfigurationProps {
  isPending: boolean;
  onChange: (repoId: string, index: number, newValue: string | undefined) => void;
  onChangeRepository: (oldRepoId: string, newRepoId: string) => void;
  projects: Project[];
}

export function RepositoryToProjectConfiguration({
  isPending,
  onChange,
  onChangeRepository,
  projects,
}: RepositoryToProjectConfigurationProps) {
  const {
    selectedRootCauseAnalysisRepositories,
    repositoryProjectMapping,
    removeRootCauseAnalysisRepository,
    repositories,
  } = useSeerOnboardingContext();

  return (
    <AppRepositoryToProjectConfiguration
      isPending={isPending}
      onChange={onChange}
      onChangeRepository={onChangeRepository}
      onRemoveRepository={removeRootCauseAnalysisRepository}
      projects={projects}
      repositories={repositories}
      repositoryProjectMapping={repositoryProjectMapping}
      selectedRootCauseAnalysisRepositories={selectedRootCauseAnalysisRepositories}
    />
  );
}
