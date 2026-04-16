import {EditableText} from 'sentry/components/editableText';
import * as Layout from 'sentry/components/layouts/thirds';
import {t} from 'sentry/locale';
import {trackAnalytics} from 'sentry/utils/analytics';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useUser} from 'sentry/utils/useUser';
import {useUpdateGroupSearchView} from 'sentry/views/issueList/mutations/useUpdateGroupSearchView';
import type {GroupSearchView} from 'sentry/views/issueList/types';

export function EditableIssueViewHeader({view}: {view: GroupSearchView}) {
  const organization = useOrganization();
  const user = useUser();

  const {mutate: updateGroupSearchView} = useUpdateGroupSearchView();

  const handleChange = (title: string) => {
    if (title !== view.name) {
      updateGroupSearchView(
        {
          name: title,
          id: view.id,
          projects: view.projects,
          query: view.query,
          querySort: view.querySort,
          timeFilters: view.timeFilters,
          environments: view.environments,
          optimistic: true,
        },
        {
          onSuccess: () => {
            trackAnalytics('issue_views.edit_name', {
              organization,
              ownership: user?.id === view.createdBy?.id ? 'personal' : 'organization',
              surface: 'issue-view-details',
            });
          },
        }
      );
    }
  };

  return (
    <Layout.Title>
      <EditableText
        value={view.name}
        onChange={handleChange}
        maxLength={128}
        aria-label={t('Edit view name')}
      />
    </Layout.Title>
  );
}
