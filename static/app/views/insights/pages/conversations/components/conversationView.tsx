import type React from 'react';
import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import styled from '@emotion/styled';

import {Container, Flex} from '@sentry/scraps/layout';
import {TabList, TabPanels, Tabs} from '@sentry/scraps/tabs';

import {EmptyMessage} from 'sentry/components/emptyMessage';
import {Placeholder} from 'sentry/components/placeholder';
import {SplitPanel} from 'sentry/components/splitPanel';
import {t} from 'sentry/locale';
import {trackAnalytics} from 'sentry/utils/analytics';
import {useDimensions} from 'sentry/utils/useDimensions';
import {useOrganization} from 'sentry/utils/useOrganization';
import {AISpanList} from 'sentry/views/insights/pages/agents/components/aiSpanList';
import {getDefaultSelectedNode} from 'sentry/views/insights/pages/agents/utils/getDefaultSelectedNode';
import type {AITraceSpanNode} from 'sentry/views/insights/pages/agents/utils/types';
import {MessagesPanel} from 'sentry/views/insights/pages/conversations/components/messagesPanel';
import {
  useConversation,
  type UseConversationsOptions,
} from 'sentry/views/insights/pages/conversations/hooks/useConversation';
import {useFocusedToolSpan} from 'sentry/views/insights/pages/conversations/hooks/useFocusedToolSpan';
import {extractMessagesFromNodes} from 'sentry/views/insights/pages/conversations/utils/conversationMessages';
import {DEFAULT_TRACE_VIEW_PREFERENCES} from 'sentry/views/performance/newTraceDetails/traceState/tracePreferences';
import {TraceStateProvider} from 'sentry/views/performance/newTraceDetails/traceState/traceStateProvider';

type ConversationTab = 'messages' | 'trace';

interface ConversationViewContentProps {
  conversation: UseConversationsOptions;
  focusedTool?: string | null;
  onSelectSpan?: (spanId: string) => void;
  selectedSpanId?: string | null;
}

/**
 * Fetches conversation data and renders the full conversation view
 * with tab switching, span selection, and detail panel.
 * Used by both the detail page and the drawer.
 */
export const ConversationViewContent = memo(function ConversationViewContent({
  conversation,
  selectedSpanId,
  onSelectSpan,
  focusedTool,
}: ConversationViewContentProps) {
  const {nodes, nodeTraceMap, isLoading, error} = useConversation(conversation);

  const handleSpanFound = useCallback(
    (spanId: string) => {
      onSelectSpan?.(spanId);
    },
    [onSelectSpan]
  );

  useFocusedToolSpan({
    nodes,
    focusedTool: focusedTool ?? null,
    isLoading,
    onSpanFound: handleSpanFound,
  });

  const handleSelectNode = useCallback(
    (node: AITraceSpanNode) => {
      onSelectSpan?.(node.id);
    },
    [onSelectSpan]
  );

  const defaultNodeId = useMemo(() => {
    const messages = extractMessagesFromNodes(nodes);
    const firstAssistant = messages.find(m => m.role === 'assistant');
    return firstAssistant?.nodeId ?? getDefaultSelectedNode(nodes)?.id;
  }, [nodes]);

  const selectedNode = useMemo(() => {
    return (
      nodes.find(node => node.id === selectedSpanId) ??
      nodes.find(node => node.id === defaultNodeId)
    );
  }, [nodes, selectedSpanId, defaultNodeId]);

  useEffect(() => {
    if (isLoading || !defaultNodeId || focusedTool) {
      return;
    }

    const isCurrentSpanValid =
      selectedSpanId && nodes.some(node => node.id === selectedSpanId);

    if (!isCurrentSpanValid) {
      onSelectSpan?.(defaultNodeId);
    }
  }, [isLoading, defaultNodeId, selectedSpanId, nodes, onSelectSpan, focusedTool]);

  return (
    <TraceStateProvider initialPreferences={DEFAULT_TRACE_VIEW_PREFERENCES}>
      <ConversationView
        nodes={nodes}
        nodeTraceMap={nodeTraceMap}
        selectedNode={selectedNode}
        onSelectNode={handleSelectNode}
        isLoading={isLoading}
        error={error}
      />
    </TraceStateProvider>
  );
});

const LEFT_PANEL_MIN_WIDTH = 400;
const RIGHT_PANEL_MIN_WIDTH = 350;
const DIVIDER_WIDTH = 5;
const SPLIT_PANEL_STORAGE_KEY = 'conversation-detail-split-panel-size';

function ConversationView({
  nodes,
  nodeTraceMap,
  selectedNode,
  onSelectNode,
  isLoading,
  error,
}: {
  error: boolean;
  isLoading: boolean;
  nodeTraceMap: Map<string, string>;
  nodes: AITraceSpanNode[];
  onSelectNode: (node: AITraceSpanNode) => void;
  selectedNode: AITraceSpanNode | undefined;
}) {
  const organization = useOrganization();
  const [activeTab, setActiveTab] = useState<ConversationTab>('messages');
  const containerRef = useRef<HTMLDivElement>(null);
  const {width: containerWidth} = useDimensions({elementRef: containerRef});

  const handleTabChange = useCallback(
    (newTab: ConversationTab) => {
      if (activeTab !== newTab) {
        trackAnalytics('conversations.drawer.tab-switch', {
          organization,
          fromTab: activeTab,
          toTab: newTab,
        });
      }
      setActiveTab(newTab);
    },
    [organization, activeTab]
  );

  if (isLoading) {
    return <ConversationViewSkeleton />;
  }

  if (error) {
    return <EmptyMessage>{t('Failed to load conversation')}</EmptyMessage>;
  }

  if (nodes.length === 0) {
    return (
      <EmptyMessage>
        {t('No AI spans found in this conversation')}
      </EmptyMessage>
    );
  }

  const defaultLeftWidth = Math.max(
    LEFT_PANEL_MIN_WIDTH,
    (containerWidth - DIVIDER_WIDTH) * 0.6
  );

  const leftPanelContent = (
    <Flex
      direction="column"
      minHeight="0"
      height="100%"
      overflow="hidden"
    >
      <StyledTabs
        value={activeTab}
        onChange={key => handleTabChange(key as ConversationTab)}
      >
        <Container borderBottom="primary">
          <TabList>
            <TabList.Item key="messages">{t('Chat')}</TabList.Item>
            <TabList.Item key="trace">{t('Spans')}</TabList.Item>
          </TabList>
        </Container>
        <Flex
          flex="1"
          minHeight="0"
          width="100%"
          overflowX="hidden"
          overflowY="auto"
        >
          <FullWidthTabPanels>
            <TabPanels.Item key="messages">
              <MessagesPanel
                nodes={nodes}
                selectedNodeId={selectedNode?.id ?? null}
                onSelectNode={onSelectNode}
              />
            </TabPanels.Item>
            <TabPanels.Item key="trace">
              <Container padding="md lg md lg">
                <AISpanList
                  nodes={nodes}
                  selectedNodeKey={
                    selectedNode?.id ?? nodes[0]?.id ?? ''
                  }
                  onSelectNode={onSelectNode}
                  compressGaps
                />
              </Container>
            </TabPanels.Item>
          </FullWidthTabPanels>
        </Flex>
      </StyledTabs>
    </Flex>
  );

  const rightPanelContent = (
    <Container
      minHeight="0"
      height="100%"
      background="primary"
      overflowY="auto"
      overflowX="hidden"
    >
      {selectedNode?.renderDetails({
        node: selectedNode,
        manager: null,
        onParentClick: () => {},
        onTabScrollToNode: () => {},
        organization,
        replay: null,
        traceId: nodeTraceMap.get(selectedNode.id) ?? '',
        hideNodeActions: true,
        initiallyCollapseAiIO: true,
      })}
    </Container>
  );

  return (
    <Flex ref={containerRef} flex="1" minHeight="0" overflow="hidden">
      {containerWidth > 0 ? (
        <SplitPanel
          availableSize={containerWidth}
          left={{
            content: leftPanelContent,
            default: defaultLeftWidth,
            min: LEFT_PANEL_MIN_WIDTH,
            max:
              containerWidth -
              RIGHT_PANEL_MIN_WIDTH -
              DIVIDER_WIDTH,
          }}
          right={rightPanelContent}
          sizeStorageKey={SPLIT_PANEL_STORAGE_KEY}
          SplitDivider={PanelBorderDivider}
        />
      ) : null}
    </Flex>
  );
}

function ConversationViewSkeleton() {
  return (
    <Flex flex="1" minHeight="0" height="100%">
      <Flex
        direction="column"
        minHeight="0"
        height="100%"
        overflow="hidden"
        flex="3"
      >
        <Container borderBottom="primary" padding="md lg">
          <Flex gap="lg">
            <Placeholder height="14px" width="40px" />
            <Placeholder height="14px" width="40px" />
          </Flex>
        </Container>
        <Flex
          direction="column"
          flex="1"
          gap="md"
          padding="lg"
          background="secondary"
        >
          <Flex direction="column" gap="sm" padding="sm md">
            <Placeholder height="12px" width="120px" />
            <Placeholder height="12px" width="80%" />
          </Flex>
          <Container
            background="primary"
            radius="md"
            border="primary"
            padding="sm md"
          >
            <Flex direction="column" gap="sm">
              <Flex align="center" gap="sm">
                <Placeholder height="12px" width="100px" />
                <Placeholder height="12px" width="40px" />
              </Flex>
              <Container
                background="tertiary"
                radius="sm"
                padding="xs sm"
              >
                <Placeholder height="12px" width="150px" />
              </Container>
              <Placeholder height="12px" width="90%" />
              <Placeholder height="12px" width="70%" />
              <Placeholder height="12px" width="60%" />
            </Flex>
          </Container>
          <Flex direction="column" gap="sm" padding="sm md">
            <Placeholder height="12px" width="120px" />
            <Placeholder height="12px" width="60%" />
          </Flex>
          <Container
            background="primary"
            radius="md"
            border="primary"
            padding="sm md"
          >
            <Flex direction="column" gap="sm">
              <Flex align="center" gap="sm">
                <Placeholder height="12px" width="80px" />
                <Placeholder height="12px" width="35px" />
              </Flex>
              <Placeholder height="12px" width="85%" />
              <Placeholder height="12px" width="50%" />
            </Flex>
          </Container>
        </Flex>
      </Flex>
      <Container borderLeft="primary" />
      <Container
        minHeight="0"
        height="100%"
        background="primary"
        overflowY="auto"
        overflowX="hidden"
        flex="2"
      >
        <Flex direction="column" gap="lg" padding="lg">
          <Flex direction="column" gap="sm">
            <Placeholder height="14px" width="180px" />
            <Placeholder height="16px" width="60px" />
          </Flex>
          <Flex direction="column" gap="sm">
            <Placeholder height="12px" width="80px" />
            <Placeholder height="12px" width="200px" />
          </Flex>
          <Flex direction="column" gap="sm">
            <Placeholder height="12px" width="60px" />
            <Placeholder height="12px" width="160px" />
          </Flex>
          <Flex direction="column" gap="sm">
            <Placeholder height="14px" width="80px" />
            <Placeholder height="80px" width="100%" />
          </Flex>
          <Flex direction="column" gap="sm">
            <Placeholder height="14px" width="80px" />
            <Placeholder height="120px" width="100%" />
          </Flex>
        </Flex>
      </Container>
    </Flex>
  );
}

type PanelDividerProps = {
  'data-is-held': boolean;
  'data-slide-direction': 'leftright' | 'updown';
  icon?: React.ReactNode;
  onDoubleClick: React.MouseEventHandler<HTMLElement>;
  onMouseDown: React.MouseEventHandler<HTMLElement>;
} & React.DOMAttributes<HTMLDivElement>;

const PanelBorderDivider = styled(
  ({icon: _icon, ...props}: PanelDividerProps) => <div {...props} />
)<PanelDividerProps>`
  width: 5px;
  height: 100%;
  cursor: ew-resize;
  position: relative;
  flex-shrink: 0;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 1px;
    background: ${p => p.theme.tokens.border.primary};
  }

  &:hover::after {
    left: 1px;
    width: 3px;
    background: ${p => p.theme.tokens.focus.default};
    border-radius: 2px;
  }

  &[data-is-held='true']::after {
    left: 1px;
    width: 3px;
    background: ${p => p.theme.tokens.focus.default};
    border-radius: 2px;
  }
`;

const StyledTabs = styled(Tabs)`
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const FullWidthTabPanels = styled(TabPanels)`
  width: 100%;
  padding: 0;

  > [role='tabpanel'] {
    width: 100%;
  }
`;
