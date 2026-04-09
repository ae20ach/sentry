import {useEffect, useState} from 'react';
import {useQuery} from '@tanstack/react-query';

import {parseQueryKey} from 'sentry/utils/api/apiQueryKey';
import {useOrganization} from 'sentry/utils/useOrganization';

import {usePrefetchFeedbackListQueryOptions} from './useFeedbackListQueryOptions';

interface Props {
  listHeadTime: number;
}

const POLLING_INTERVAL_MS = 10_000;

export function useFeedbackHasNewItems({listHeadTime}: Props) {
  const organization = useOrganization();
  const listPrefetchQueryOptions = usePrefetchFeedbackListQueryOptions({
    listHeadTime,
    organization,
  });

  const [foundData, setFoundData] = useState(false);

  const {statsPeriod} =
    parseQueryKey(listPrefetchQueryOptions.queryKey).options?.query ?? {};
  const {data} = useQuery({
    ...listPrefetchQueryOptions,
    refetchInterval: POLLING_INTERVAL_MS,
    enabled: statsPeriod && !foundData,
  });

  useEffect(() => {
    // Once we found something, no need to keep polling.
    setFoundData(Boolean(data?.length));
  }, [data]);

  useEffect(() => {
    // New key, start polling again
    setFoundData(false);
  }, [listHeadTime]);

  return Boolean(data?.length);
}
