import {useCallback} from 'react';

import {useFeedbackCache} from 'sentry/components/feedback/useFeedbackCache';
import {useInfiniteFeedbackListQueryOptions} from 'sentry/components/feedback/useFeedbackListQueryOptions';
import {useFeedbackQueryKeys} from 'sentry/components/feedback/useFeedbackQueryKeys';
import {useQueryClient} from 'sentry/utils/queryClient';
import {useOrganization} from 'sentry/utils/useOrganization';

export function useRefetchFeedbackList() {
  const queryClient = useQueryClient();
  const organization = useOrganization();
  const {listHeadTime, resetListHeadTime} = useFeedbackQueryKeys();
  const listQueryOptions = useInfiniteFeedbackListQueryOptions({
    listHeadTime,
    organization,
  });
  const {invalidateListCache} = useFeedbackCache();

  const refetchFeedbackList = useCallback(() => {
    queryClient.invalidateQueries({queryKey: listQueryOptions.queryKey});
    resetListHeadTime();
    invalidateListCache();
  }, [queryClient, listQueryOptions.queryKey, resetListHeadTime, invalidateListCache]);

  return {refetchFeedbackList};
}
