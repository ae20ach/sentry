import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type {VirtualItem, Virtualizer} from '@tanstack/react-virtual';
import {parseAsInteger, useQueryState} from 'nuqs';

import type {VisibleRange} from 'sentry/components/replays/useJumpButtons';
import type {SpanFrame} from 'sentry/utils/replays/types';
import {NETWORK_LIST_PAGE_SIZE} from 'sentry/views/replays/detail/network/constants';
import {getVisibleRangeFromVirtualRows} from 'sentry/views/replays/detail/virtualizedTableUtils';

type SetPage = (
  value: number | null | ((old: number | null) => number | null)
) => Promise<URLSearchParams>;

/**
 * URL pagination, page window, clamp, jump-to-row, and prev/next for the replay Network table.
 */
export function useNetworkListPaging(items: SpanFrame[], replayId: string | undefined) {
  const [page, setPage] = useQueryState(
    'n_page',
    parseAsInteger.withDefault(0).withOptions({history: 'push', throttleMs: 0})
  );

  const maxPageIndex = useMemo(
    () =>
      items.length === 0
        ? 0
        : Math.max(0, Math.ceil(items.length / NETWORK_LIST_PAGE_SIZE) - 1),
    [items.length]
  );

  const safePage = Math.min(page, maxPageIndex);

  const pageOffset = safePage * NETWORK_LIST_PAGE_SIZE;
  const pageItems = useMemo(
    () => items.slice(pageOffset, pageOffset + NETWORK_LIST_PAGE_SIZE),
    [items, pageOffset]
  );

  const totalPages = maxPageIndex + 1;

  const pendingScrollToIndexRef = useRef<number | null>(null);
  /** Bumped on every scroll-to-row request so the virtualizer effect runs even when `safePage` is unchanged. */
  const [scrollGeneration, setScrollGeneration] = useState(0);
  const didInitialDetailPageSyncRef = useRef(false);

  useEffect(() => {
    didInitialDetailPageSyncRef.current = false;
  }, [replayId]);

  useEffect(() => {
    if (items.length === 0) {
      return;
    }
    if (page > maxPageIndex) {
      pendingScrollToIndexRef.current = 0;
      setPage(maxPageIndex);
    }
  }, [page, maxPageIndex, items.length, setPage]);

  const handleScrollToTableRow = useCallback(
    (row: number) => {
      const global0 = row - 1;
      const targetPage = Math.floor(global0 / NETWORK_LIST_PAGE_SIZE);
      const localIndex = global0 % NETWORK_LIST_PAGE_SIZE;
      pendingScrollToIndexRef.current = localIndex;
      setPage(targetPage);
      setScrollGeneration(g => g + 1);
    },
    [setPage]
  );

  const onPreviousPage = useCallback(() => {
    pendingScrollToIndexRef.current = 0;
    setPage(p => Math.max(0, p - 1));
  }, [setPage]);

  const onNextPage = useCallback(() => {
    pendingScrollToIndexRef.current = 0;
    setPage(p => Math.min(maxPageIndex, p + 1));
  }, [maxPageIndex, setPage]);

  return {
    didInitialDetailPageSyncRef,
    handleScrollToTableRow,
    onNextPage,
    onPreviousPage,
    pageItems,
    pageOffset,
    pendingScrollToIndexRef,
    safePage,
    scrollGeneration,
    setPage,
    totalPages,
  };
}

/**
 * After `useVirtualizedGrid`: apply pending scroll to the page window and compute jump-button visible range.
 */
export function useNetworkListVirtualSync({
  pageItemsLength,
  pageOffset,
  pendingScrollToIndexRef,
  safePage,
  scrollGeneration,
  virtualRows,
  virtualizer,
}: {
  pageItemsLength: number;
  pageOffset: number;
  pendingScrollToIndexRef: MutableRefObject<number | null>;
  safePage: number;
  scrollGeneration: number;
  virtualRows: VirtualItem[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
}): {visibleRange: VisibleRange} {
  useEffect(() => {
    const idx = pendingScrollToIndexRef.current;
    if (idx === null) {
      return undefined;
    }
    pendingScrollToIndexRef.current = null;
    const timer = window.setTimeout(() => {
      virtualizer.scrollToIndex(idx, {align: 'auto'});
    }, 50);
    return () => {
      window.clearTimeout(timer);
    };
    // scrollGeneration: same-page jump (e.g. Jump to current timestamp) must re-run without a page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingScrollToIndexRef is a stable ref
  }, [safePage, virtualizer, pageItemsLength, scrollGeneration]);

  const visibleRange = useMemo<VisibleRange>(() => {
    return getVisibleRangeFromVirtualRows({
      indexOffset: pageOffset + 1,
      scrollOffset: virtualizer.scrollOffset ?? 0,
      viewportHeight: virtualizer.scrollRect?.height ?? 0,
      virtualRows,
    });
  }, [pageOffset, virtualRows, virtualizer.scrollOffset, virtualizer.scrollRect?.height]);

  return {visibleRange};
}

/**
 * Call after `useDetailsSplit`: align `n_page` with `n_detail_row` on first load per replay.
 */
export function useNetworkListDetailUrlPageSync({
  didInitialDetailPageSyncRef,
  itemsLength,
  pendingScrollToIndexRef,
  replayId,
  safePage,
  selectedIndex,
  setPage,
}: {
  didInitialDetailPageSyncRef: MutableRefObject<boolean>;
  itemsLength: number;
  pendingScrollToIndexRef: MutableRefObject<number | null>;
  replayId: string | undefined;
  safePage: number;
  selectedIndex: number | null;
  setPage: SetPage;
}) {
  useEffect(() => {
    if (!replayId || itemsLength === 0) {
      return;
    }
    if (didInitialDetailPageSyncRef.current) {
      return;
    }
    if (selectedIndex === null || selectedIndex >= itemsLength) {
      didInitialDetailPageSyncRef.current = true;
      return;
    }
    const targetPage = Math.floor(selectedIndex / NETWORK_LIST_PAGE_SIZE);
    if (targetPage !== safePage) {
      pendingScrollToIndexRef.current = selectedIndex % NETWORK_LIST_PAGE_SIZE;
      setPage(targetPage);
    }
    didInitialDetailPageSyncRef.current = true;
  }, [
    didInitialDetailPageSyncRef,
    itemsLength,
    pendingScrollToIndexRef,
    replayId,
    selectedIndex,
    safePage,
    setPage,
  ]);
}
