import {useEffect} from 'react';

import {useSourceMapDebugQuery} from 'sentry/components/events/interfaces/crashContent/exception/useSourceMapDebuggerData';
import type {Event} from 'sentry/types/event';
import type {Group} from 'sentry/types/group';
import type {Project} from 'sentry/types/project';
import {trackAnalytics} from 'sentry/utils/analytics';
import {useOrganization} from 'sentry/utils/useOrganization';
import {SectionDivider} from 'sentry/views/issueDetails/streamline/foldSection';

import {DiagnosisSection} from './diagnosisSection';
import {ImpactSection} from './impactSection';
import {ProblemSection} from './problemSection';
import {TroubleshootingSection} from './troubleshootingSection';

interface SourceMapIssueDetailsProps {
  event: Event;
  group: Group;
  project: Project;
}

export function SourceMapIssueDetails({event, project}: SourceMapIssueDetailsProps) {
  const organization = useOrganization();
  const sourceMapQuery = useSourceMapDebugQuery(
    project.slug,
    event.occurrence?.evidenceData?.sampleEventId,
    event.sdk?.name ?? null
  );

  useEffect(() => {
    trackAnalytics('issue_details.sourcemap_configuration.viewed', {
      organization,
      project_id: project.id,
      project_slug: project.slug,
      platform: project.platform ?? null,
    });
  }, [organization, project.id, project.slug, project.platform]);

  return (
    <div>
      <ProblemSection />
      <SectionDivider orientation="horizontal" />
      <DiagnosisSection sourceMapQuery={sourceMapQuery} />
      <SectionDivider orientation="horizontal" />
      <TroubleshootingSection project={project} />
      <SectionDivider orientation="horizontal" />
      <ImpactSection project={project} />
    </div>
  );
}
