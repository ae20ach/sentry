import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {MutableSearch} from 'sentry/utils/tokenizeSearch';
import {useSpans} from 'sentry/views/insights/common/queries/useDiscover';

interface Props {
  limit: number;
  transaction: string;
  statsPeriod?: string;
}

export function useReplayCountForTransactions({
  limit,
  transaction,
  statsPeriod = '14d',
}: Props): number | undefined {
  const {selection} = usePageFilters();

  const search = new MutableSearch('has:replay.id is_transaction:true');
  search.addFilterValue('transaction', transaction);

  const {data, isPending} = useSpans(
    {
      search,
      // `count()` ensures we get one row per unique replay ID
      fields: ['replay.id', 'count()'],
      limit: limit + 1,
      pageFilters: {
        ...selection,
        datetime: {
          period: statsPeriod,
          start: null,
          end: null,
          utc: selection.datetime.utc,
        },
      },
    },
    'api.performance.transaction-summary.replay-count'
  );

  return isPending ? undefined : data.length;
}
