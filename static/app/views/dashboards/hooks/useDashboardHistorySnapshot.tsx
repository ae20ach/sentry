import {makeDashboardHistorySnapshotQueryKey} from 'sentry/actionCreators/dashboards';
import {useApiQuery} from 'sentry/utils/queryClient';
import {useOrganization} from 'sentry/utils/useOrganization';
import type {DashboardDetails} from 'sentry/views/dashboards/types';

interface UseDashboardHistorySnapshotOptions {
  dashboardId: string;
  historyId: string | null;
}

export function useDashboardHistorySnapshot({
  dashboardId,
  historyId,
}: UseDashboardHistorySnapshotOptions) {
  const organization = useOrganization();
  return useApiQuery<DashboardDetails>(
    makeDashboardHistorySnapshotQueryKey(
      organization.slug,
      dashboardId,
      historyId ?? 'none'
    ),
    {
      staleTime: 30_000,
      enabled: !!historyId,
    }
  );
}
