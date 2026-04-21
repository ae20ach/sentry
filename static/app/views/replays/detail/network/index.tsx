import {useCallback, useRef} from 'react';

import {Flex} from '@sentry/scraps/layout';
import {ExternalLink} from '@sentry/scraps/link';

import {Placeholder} from 'sentry/components/placeholder';
import {JumpButtons} from 'sentry/components/replays/jumpButtons';
import {useReplayContext} from 'sentry/components/replays/replayContext';
import {useJumpButtons} from 'sentry/components/replays/useJumpButtons';
import {GridTable} from 'sentry/components/replays/virtualizedGrid/gridTable';
import {SplitPanel} from 'sentry/components/replays/virtualizedGrid/splitPanel';
import {useDetailsSplit} from 'sentry/components/replays/virtualizedGrid/useDetailsSplit';
import {t, tct} from 'sentry/locale';
import {trackAnalytics} from 'sentry/utils/analytics';
import {useCrumbHandlers} from 'sentry/utils/replays/hooks/useCrumbHandlers';
import {useReplayReader} from 'sentry/utils/replays/playback/providers/replayReaderProvider';
import {useCurrentHoverTime} from 'sentry/utils/replays/playback/providers/useCurrentHoverTime';
import {getFrameMethod, getFrameStatus} from 'sentry/utils/replays/resourceFrame';
import {useOrganization} from 'sentry/utils/useOrganization';
import {FilterLoadingIndicator} from 'sentry/views/replays/detail/filterLoadingIndicator';
import {NetworkDetails} from 'sentry/views/replays/detail/network/details';
import {NetworkFilters} from 'sentry/views/replays/detail/network/networkFilters';
import {
  COLUMN_COUNT,
  NetworkHeaderCell,
} from 'sentry/views/replays/detail/network/networkHeaderCell';
import {NetworkPaginationRow} from 'sentry/views/replays/detail/network/networkPaginationRow';
import {NetworkTableCell} from 'sentry/views/replays/detail/network/networkTableCell';
import {
  NETWORK_DETAILS_SPLIT_HANDLE_HEIGHT,
  NETWORK_TABLE_BODY_ROW_HEIGHT,
  NETWORK_TABLE_DEFAULT_COLUMN_WIDTH,
  NETWORK_TABLE_DYNAMIC_COLUMN_INDEX,
  NETWORK_TABLE_HEADER_HEIGHT,
  NETWORK_TABLE_MIN_DYNAMIC_COLUMN_WIDTH,
  NETWORK_TABLE_OVERSCAN,
  NETWORK_TABLE_STATIC_COLUMN_WIDTHS,
} from 'sentry/views/replays/detail/network/networkTableLayout';
import {useNetworkFilters} from 'sentry/views/replays/detail/network/useNetworkFilters';
import {
  useNetworkListDetailUrlPageSync,
  useNetworkListPaging,
  useNetworkListVirtualSync,
} from 'sentry/views/replays/detail/network/useNetworkListTable';
import {useSortNetwork} from 'sentry/views/replays/detail/network/useSortNetwork';
import {NoRowRenderer} from 'sentry/views/replays/detail/noRowRenderer';
import {useVirtualizedGrid} from 'sentry/views/replays/detail/useVirtualizedGrid';
import {VirtualTable} from 'sentry/views/replays/detail/virtualizedTableLayout';
import {getTimelineRowClassName} from 'sentry/views/replays/detail/virtualizedTableUtils';

export function NetworkList() {
  const organization = useOrganization();
  const replay = useReplayReader();
  const replayId = replay?.getReplay()?.id;
  const {currentTime} = useReplayContext();
  const [currentHoverTime] = useCurrentHoverTime();
  const {onMouseEnter, onMouseLeave, onClickTimestamp} = useCrumbHandlers();

  const isNetworkDetailsSetup = Boolean(replay?.isNetworkDetailsSetup());
  const isCaptureBodySetup = Boolean(replay?.isNetworkCaptureBodySetup());
  const networkFrames = replay?.getNetworkFrames();
  const projectId = replay?.getReplay()?.project_id;
  const startTimestampMs = replay?.getReplay()?.started_at?.getTime() || 0;

  const filterProps = useNetworkFilters({networkFrames: networkFrames || []});
  const {items: filteredItems, setSearchTerm} = filterProps;
  const clearSearchTerm = () => setSearchTerm('');
  const {handleSort, items, sortConfig} = useSortNetwork({items: filteredItems});

  const {
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
  } = useNetworkListPaging(items, replayId);

  const containerRef = useRef<HTMLDivElement>(null);
  const {
    gridTemplateColumns,
    scrollContainerRef,
    totalColumnWidth,
    virtualRows,
    virtualizer,
    wrapperRef,
  } = useVirtualizedGrid({
    defaultColumnWidth: NETWORK_TABLE_DEFAULT_COLUMN_WIDTH,
    dynamicColumnIndex: NETWORK_TABLE_DYNAMIC_COLUMN_INDEX,
    minDynamicColumnWidth: NETWORK_TABLE_MIN_DYNAMIC_COLUMN_WIDTH,
    overscan: NETWORK_TABLE_OVERSCAN,
    rowCount: pageItems.length,
    rowHeight: NETWORK_TABLE_BODY_ROW_HEIGHT,
    staticColumnWidths: NETWORK_TABLE_STATIC_COLUMN_WIDTHS,
  });

  const {visibleRange} = useNetworkListVirtualSync({
    pageItemsLength: pageItems.length,
    pageOffset,
    pendingScrollToIndexRef,
    safePage,
    scrollGeneration,
    virtualRows,
    virtualizer,
  });

  const {
    handleClick: onClickToJump,
    showJumpDownButton,
    showJumpUpButton,
  } = useJumpButtons({
    currentTime,
    frames: filteredItems,
    isTable: true,
    setScrollToRow: handleScrollToTableRow,
    visibleRange,
  });

  const {
    onClickCell,
    onCloseDetailsSplit,
    resizableDrawerProps,
    selectedIndex,
    splitSize,
  } = useDetailsSplit({
    containerRef,
    frames: networkFrames,
    handleHeight: NETWORK_DETAILS_SPLIT_HANDLE_HEIGHT,
    urlParamName: 'n_detail_row',
    onShowDetails: useCallback(
      ({dataIndex, rowIndex}: {dataIndex: number; rowIndex: number}) => {
        handleScrollToTableRow(rowIndex);
        const item = items[dataIndex];
        if (!item) {
          return;
        }
        trackAnalytics('replay.details-network-panel-opened', {
          is_sdk_setup: isNetworkDetailsSetup,
          organization,
          resource_method: getFrameMethod(item),
          resource_status: String(getFrameStatus(item)),
          resource_type: item.op,
        });
      },
      [handleScrollToTableRow, isNetworkDetailsSetup, items, organization]
    ),
    onHideDetails: useCallback(() => {
      trackAnalytics('replay.details-network-panel-closed', {
        is_sdk_setup: isNetworkDetailsSetup,
        organization,
      });
    }, [isNetworkDetailsSetup, organization]),
  });

  useNetworkListDetailUrlPageSync({
    didInitialDetailPageSyncRef,
    itemsLength: items.length,
    pendingScrollToIndexRef,
    replayId,
    safePage,
    selectedIndex,
    setPage,
  });

  const selectedItem = selectedIndex === null ? null : (items[selectedIndex] ?? null);

  return (
    <Flex direction="column" wrap="nowrap">
      <FilterLoadingIndicator isLoading={!replay}>
        <NetworkFilters networkFrames={networkFrames} {...filterProps} />
      </FilterLoadingIndicator>
      <GridTable ref={containerRef} data-test-id="replay-details-network-tab">
        <SplitPanel
          style={{
            gridTemplateRows: splitSize === undefined ? '1fr' : `1fr auto ${splitSize}px`,
          }}
        >
          {networkFrames ? (
            <Flex
              direction="column"
              height="100%"
              minHeight={0}
              overflow="hidden"
              position="relative"
            >
              <Flex flex={1} direction="column" minHeight={0} position="relative">
                <VirtualTable ref={wrapperRef}>
                  <VirtualTable.BodyScrollContainer ref={scrollContainerRef}>
                    <VirtualTable.HeaderViewport style={{width: totalColumnWidth}}>
                      <VirtualTable.HeaderRow
                        style={{
                          gridTemplateColumns,
                        }}
                      >
                        {Array.from({length: COLUMN_COUNT}, (_, columnIndex) => (
                          <NetworkHeaderCell
                            key={columnIndex}
                            handleSort={handleSort}
                            index={columnIndex}
                            sortConfig={sortConfig}
                            style={{height: NETWORK_TABLE_HEADER_HEIGHT}}
                          />
                        ))}
                      </VirtualTable.HeaderRow>
                    </VirtualTable.HeaderViewport>
                    {items.length === 0 ? (
                      <VirtualTable.NoRowsContainer>
                        <NoRowRenderer
                          unfilteredItems={networkFrames}
                          clearSearchTerm={clearSearchTerm}
                        >
                          {replay?.getReplay()?.sdk.name?.includes('flutter')
                            ? tct(
                                'No network requests recorded. Make sure you are using either the [link1:Sentry Dio] or the [link2:Sentry HTTP] integration.',
                                {
                                  link1: (
                                    <ExternalLink href="https://docs.sentry.io/platforms/dart/integrations/dio/" />
                                  ),
                                  link2: (
                                    <ExternalLink href="https://docs.sentry.io/platforms/dart/integrations/http-integration/" />
                                  ),
                                }
                              )
                            : t('No network requests recorded')}
                        </NoRowRenderer>
                      </VirtualTable.NoRowsContainer>
                    ) : (
                      <VirtualTable.Content
                        style={{
                          height: virtualizer.getTotalSize(),
                          width: totalColumnWidth,
                        }}
                      >
                        <VirtualTable.Offset
                          offset={virtualRows[0]?.start ?? 0}
                          style={{width: totalColumnWidth}}
                        >
                          {virtualRows.map(virtualRow => {
                            const network = pageItems[virtualRow.index];
                            if (!network) {
                              return null;
                            }

                            const rowIndex = pageOffset + virtualRow.index + 1;
                            const isByTimestamp = sortConfig.by === 'startTimestamp';
                            const hasOccurred = currentTime >= network.offsetMs;
                            const isBeforeHover =
                              currentHoverTime === undefined ||
                              currentHoverTime >= network.offsetMs;
                            const isAsc = isByTimestamp ? sortConfig.asc : false;

                            const rowClassName = getTimelineRowClassName({
                              hasHoverTime: currentHoverTime !== undefined,
                              hasOccurred,
                              isAsc,
                              isBeforeHover,
                              isByTimestamp,
                              isLastDataRow:
                                pageOffset + virtualRow.index === items.length - 1,
                            });

                            return (
                              <VirtualTable.BodyRow
                                useTransparentBorders
                                key={virtualRow.key}
                                className={rowClassName}
                                data-index={virtualRow.index}
                                style={{
                                  gridTemplateColumns,
                                  height: NETWORK_TABLE_BODY_ROW_HEIGHT,
                                }}
                              >
                                {Array.from({length: COLUMN_COUNT}, (_, columnIndex) => (
                                  <NetworkTableCell
                                    key={`${virtualRow.key}-${columnIndex}`}
                                    columnIndex={columnIndex}
                                    frame={network}
                                    onMouseEnter={onMouseEnter}
                                    onMouseLeave={onMouseLeave}
                                    onClickCell={onClickCell}
                                    onClickTimestamp={onClickTimestamp}
                                    rowIndex={rowIndex}
                                    startTimestampMs={startTimestampMs}
                                    style={{height: NETWORK_TABLE_BODY_ROW_HEIGHT}}
                                  />
                                ))}
                              </VirtualTable.BodyRow>
                            );
                          })}
                        </VirtualTable.Offset>
                      </VirtualTable.Content>
                    )}
                  </VirtualTable.BodyScrollContainer>
                </VirtualTable>
                {sortConfig.by === 'startTimestamp' && items.length ? (
                  <JumpButtons
                    jump={
                      showJumpUpButton ? 'up' : showJumpDownButton ? 'down' : undefined
                    }
                    onClick={onClickToJump}
                    tableHeaderHeight={NETWORK_TABLE_HEADER_HEIGHT}
                  />
                ) : null}
              </Flex>
              <NetworkPaginationRow
                onNextPage={onNextPage}
                onPreviousPage={onPreviousPage}
                pageOffset={pageOffset}
                safePage={safePage}
                totalCount={items.length}
                totalPages={totalPages}
              />
            </Flex>
          ) : (
            <Placeholder height="100%" />
          )}
          <NetworkDetails
            {...resizableDrawerProps}
            isSetup={isNetworkDetailsSetup}
            isCaptureBodySetup={isCaptureBodySetup}
            item={selectedItem}
            onClose={onCloseDetailsSplit}
            projectId={projectId}
            startTimestampMs={startTimestampMs}
          />
        </SplitPanel>
      </GridTable>
    </Flex>
  );
}
