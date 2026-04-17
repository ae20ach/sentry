import {Fragment, useState} from 'react';
import styled from '@emotion/styled';

import {Button} from '@sentry/scraps/button';
import {Flex} from '@sentry/scraps/layout';

import {Confirm} from 'sentry/components/confirm';
import {Pagination} from 'sentry/components/pagination';
import {SimilarSpectrum} from 'sentry/components/similarSpectrum';
import {SimpleTable} from 'sentry/components/tables/simpleTable';
import {t, tn} from 'sentry/locale';
import type {Project} from 'sentry/types/project';

import {SimilarStackTraceItem} from './item';
import type {SimilarItem} from './types';

type Props = {
  busyIds: ReadonlySet<string>;
  checkedIds: ReadonlySet<string>;
  filteredItems: SimilarItem[];
  groupId: string;
  hasSimilarityEmbeddingsFeature: boolean;
  items: SimilarItem[];
  onMerge: () => void;
  onToggle: (id: string) => void;
  pageLinks: string | null;
  project: Project;
};

export function List({
  groupId,
  project,
  items,
  filteredItems,
  pageLinks,
  onMerge,
  onToggle,
  checkedIds,
  busyIds,
  hasSimilarityEmbeddingsFeature,
}: Props) {
  const [showAllItems, setShowAllItems] = useState(false);

  const hasHiddenItems = !!filteredItems.length;
  const itemsWithFiltered = items.concat(showAllItems ? filteredItems : []);
  const mergeCount = checkedIds.size;

  return (
    <Fragment>
      <Flex justify="end" marginBottom="md">
        <SimilarSpectrum
          highSpectrumLabel={
            hasSimilarityEmbeddingsFeature ? t('Most Similar') : t('Similar')
          }
          lowSpectrumLabel={
            hasSimilarityEmbeddingsFeature ? t('Less Similar') : t('Not Similar')
          }
        />
      </Flex>

      <StyledSimpleTable hasMessageColumn={!hasSimilarityEmbeddingsFeature}>
        <SimpleTable.Header>
          <MergeHeaderCell>
            <Confirm
              disabled={mergeCount === 0}
              message={tn(
                'Merge %s issue into this one?',
                'Merge %s issues into this one?',
                mergeCount
              )}
              onConfirm={onMerge}
            >
              <Button size="xs">
                {tn('Merge %s issue', 'Merge %s issues', mergeCount)}
              </Button>
            </Confirm>
          </MergeHeaderCell>
          <CenteredHeaderCell>{t('Events')}</CenteredHeaderCell>
          <CenteredHeaderCell>{t('Exception')}</CenteredHeaderCell>
          {!hasSimilarityEmbeddingsFeature && (
            <CenteredHeaderCell>{t('Message')}</CenteredHeaderCell>
          )}
          <SimpleTable.HeaderCell />
        </SimpleTable.Header>

        {itemsWithFiltered.map(item => (
          <SimilarStackTraceItem
            key={item.issue.id}
            groupId={groupId}
            project={project}
            hasSimilarityEmbeddingsFeature={hasSimilarityEmbeddingsFeature}
            checked={checkedIds.has(item.issue.id)}
            busy={busyIds.has(item.issue.id)}
            onToggle={onToggle}
            {...item}
          />
        ))}
      </StyledSimpleTable>

      {hasHiddenItems && !showAllItems && !hasSimilarityEmbeddingsFeature && (
        <Flex justify="center" padding="lg">
          <Button onClick={() => setShowAllItems(true)}>
            {tn(
              'Show %s issue below threshold',
              'Show %s issues below threshold',
              filteredItems.length
            )}
          </Button>
        </Flex>
      )}

      <Pagination pageLinks={pageLinks} />
    </Fragment>
  );
}

const StyledSimpleTable = styled(SimpleTable, {
  shouldForwardProp: prop => prop !== 'hasMessageColumn',
})<{hasMessageColumn: boolean}>`
  grid-template-columns: ${p =>
    p.hasMessageColumn
      ? 'minmax(0, 1fr) 70px 90px 90px 80px'
      : 'minmax(0, 1fr) 70px 90px 80px'};
`;

const CenteredHeaderCell = styled(SimpleTable.HeaderCell)`
  justify-content: center;
`;

const MergeHeaderCell = styled(SimpleTable.HeaderCell)`
  justify-content: flex-start;
  padding-left: ${p => p.theme.space.md};
`;
