import {Fragment, useMemo} from 'react';
import styled from '@emotion/styled';
import uniqBy from 'lodash/uniqBy';

import waitingForEventImg from 'sentry-images/spot/waiting-for-event.svg';

import {Stack} from '@sentry/scraps/layout';
import {Tooltip} from '@sentry/scraps/tooltip';

import {ErrorBoundary} from 'sentry/components/errorBoundary';
import {FeedbackListHeader} from 'sentry/components/feedback/list/feedbackListHeader';
import {FeedbackListItem} from 'sentry/components/feedback/list/feedbackListItem';
import {useInfiniteFeedbackListQueryOptions} from 'sentry/components/feedback/useFeedbackListQueryOptions';
import {useFeedbackQueryKeys} from 'sentry/components/feedback/useFeedbackQueryKeys';
import {InfiniteListItems} from 'sentry/components/infiniteList/infiniteListItems';
import {InfiniteListState} from 'sentry/components/infiniteList/infiniteListState';
import {LoadingIndicator} from 'sentry/components/loadingIndicator';
import {t} from 'sentry/locale';
import type {ApiResponse} from 'sentry/utils/api/apiFetch';
import type {FeedbackIssueListItem} from 'sentry/utils/feedback/types';
import {useListItemCheckboxContext} from 'sentry/utils/list/useListItemCheckboxState';
import {useInfiniteQuery} from 'sentry/utils/queryClient';
import {useOrganization} from 'sentry/utils/useOrganization';

function NoFeedback() {
  return (
    <NoFeedbackWrapper>
      <img src={waitingForEventImg} alt={t('A person waiting for a phone to ring')} />
      <NoFeedbackMessage>{t('Inbox Zero')}</NoFeedbackMessage>
      <p>{t('You have two options: take a nap or be productive.')}</p>
    </NoFeedbackWrapper>
  );
}

interface Props {
  onItemSelect: (itemIndex?: number) => void;
}

export function FeedbackList({onItemSelect}: Props) {
  const {listHeadTime} = useFeedbackQueryKeys();
  const organization = useOrganization();
  const listQueryOptions = useInfiniteFeedbackListQueryOptions({
    listHeadTime,
    organization,
  });
  const queryResult = useInfiniteQuery({
    ...listQueryOptions,
    enabled: Boolean(listQueryOptions.queryKey),
  });

  // Can't use `select()` in useInfiniteQuery() because `<InfiniteListItems>`
  // has it's own stuff going on, and that's a larger refactor for another time.
  const issues = useMemo(
    () =>
      uniqBy(
        queryResult.data?.pages.flatMap(result => result.json ?? []),
        'id'
      ),
    [queryResult.data?.pages]
  );
  const hits = queryResult.data?.pages[0]?.headers['X-Hits'] ?? issues.length;

  const checkboxState = useListItemCheckboxContext({
    hits,
    knownIds: issues.map(issue => issue.id),
    queryKey: listQueryOptions.queryKey,
  });

  return (
    <Fragment>
      <FeedbackListHeader {...checkboxState} />
      <Stack flexGrow={1} paddingBottom="xs">
        <InfiniteListState
          queryResult={queryResult}
          backgroundUpdatingMessage={() => null}
          loadingMessage={() => <LoadingIndicator />}
        >
          <InfiniteListItems<FeedbackIssueListItem, ApiResponse<FeedbackIssueListItem[]>>
            deduplicateItems={pages =>
              uniqBy(
                pages.flatMap(page => page.json ?? []),
                'id'
              )
            }
            estimateSize={() => 80}
            queryResult={queryResult}
            itemRenderer={({item, virtualItem}) => {
              const itemIndex = virtualItem.index;
              return (
                <ErrorBoundary mini>
                  <FeedbackListItem
                    feedbackItem={item}
                    isSelected={checkboxState.isSelected(item.id)}
                    onSelect={() => {
                      checkboxState.toggleSelected(item.id);
                    }}
                    onItemSelect={() => onItemSelect(itemIndex)}
                  />
                </ErrorBoundary>
              );
            }}
            emptyMessage={() => <NoFeedback />}
            loadingMoreMessage={() => (
              <Centered>
                <Tooltip title={t('Loading more feedback...')}>
                  <LoadingIndicator mini />
                </Tooltip>
              </Centered>
            )}
            loadingCompleteMessage={() => null}
          />
        </InfiniteListState>
      </Stack>
    </Fragment>
  );
}

const Centered = styled('div')`
  justify-self: center;
`;

const NoFeedbackWrapper = styled('div')`
  padding: ${p => p.theme.space['3xl']} ${p => p.theme.space['3xl']};
  text-align: center;
  color: ${p => p.theme.tokens.content.secondary};

  @media (max-width: ${p => p.theme.breakpoints.sm}) {
    font-size: ${p => p.theme.font.size.md};
  }
`;

const NoFeedbackMessage = styled('div')`
  font-weight: ${p => p.theme.font.weight.sans.medium};
  color: ${p => p.theme.colors.gray500};

  @media (min-width: ${p => p.theme.breakpoints.sm}) {
    font-size: ${p => p.theme.font.size.xl};
  }
`;
