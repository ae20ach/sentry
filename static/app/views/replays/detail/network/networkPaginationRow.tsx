import {PaginationFooter} from '@sentry/scraps/paginationFooter';

import {tct} from 'sentry/locale';
import {NETWORK_LIST_PAGE_SIZE} from 'sentry/views/replays/detail/network/constants';

type Props = {
  onNextPage: () => void;
  onPreviousPage: () => void;
  pageOffset: number;
  safePage: number;
  totalCount: number;
  totalPages: number;
};

export function NetworkPaginationRow({
  onNextPage,
  onPreviousPage,
  pageOffset,
  safePage,
  totalCount,
  totalPages,
}: Props) {
  if (totalCount <= NETWORK_LIST_PAGE_SIZE) {
    return null;
  }

  const rangeStart = pageOffset + 1;
  const rangeEnd = Math.min(pageOffset + NETWORK_LIST_PAGE_SIZE, totalCount);

  return (
    <PaginationFooter
      background="primary"
      borderTop="primary"
      caption={tct('[start]–[end] of [total]', {
        start: rangeStart.toLocaleString(),
        end: rangeEnd.toLocaleString(),
        total: totalCount.toLocaleString(),
      })}
      flexShrink={0}
      isNextDisabled={safePage >= totalPages - 1}
      isPreviousDisabled={safePage === 0}
      padding="sm md"
      size="small"
      width="100%"
      onNext={onNextPage}
      onPrevious={onPreviousPage}
    />
  );
}
