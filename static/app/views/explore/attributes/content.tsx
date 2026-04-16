import {useEffect, useMemo, useState} from 'react';
import styled from '@emotion/styled';
import {useQueries} from '@tanstack/react-query';

import {Tag} from '@sentry/scraps/badge';
import {Button} from '@sentry/scraps/button';
import {CompactSelect} from '@sentry/scraps/compactSelect';
import {Link} from '@sentry/scraps/link';

import * as Layout from 'sentry/components/layouts/thirds';
import {PageFiltersContainer} from 'sentry/components/pageFilters/container';
import {EnvironmentPageFilter} from 'sentry/components/pageFilters/environment/environmentPageFilter';
import {PageFilterBar} from 'sentry/components/pageFilters/pageFilterBar';
import {normalizeDateTimeParams} from 'sentry/components/pageFilters/parse';
import {ProjectPageFilter} from 'sentry/components/pageFilters/project/projectPageFilter';
import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {SentryDocumentTitle} from 'sentry/components/sentryDocumentTitle';
import {IconChevron} from 'sentry/icons/iconChevron';
import {IconSearch} from 'sentry/icons/iconSearch';
import {IconStar} from 'sentry/icons/iconStar';
import {t} from 'sentry/locale';
import {normalizeUrl} from 'sentry/utils/url/normalizeUrl';
import {useApi} from 'sentry/utils/useApi';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useHasPageFrameFeature} from 'sentry/views/navigation/useHasPageFrameFeature';

type AttributeType = 'string' | 'number' | 'boolean';

interface RawAttribute {
  key: string;
  name: string;
}

interface Attribute {
  key: string;
  name: string;
  type: AttributeType;
}

const TYPE_OPTIONS = [
  {value: 'all' as const, label: t('All')},
  {value: 'string' as const, label: t('string')},
  {value: 'number' as const, label: t('number')},
  {value: 'boolean' as const, label: t('bool')},
];

const DATASET_OPTIONS = [{value: 'spans' as const, label: t('Spans')}];

const ATTRIBUTE_TYPES: AttributeType[] = ['string', 'number', 'boolean'];

const TYPE_TAG_VARIANT: Record<AttributeType, 'info'> = {
  string: 'info',
  number: 'info',
  boolean: 'info',
};

const TYPE_DISPLAY_LABEL: Record<AttributeType, string> = {
  string: 'string',
  number: 'number',
  boolean: 'bool',
};

const ITEMS_PER_PAGE = 20;

export default function AttributesContent() {
  const organization = useOrganization();
  const {selection} = usePageFilters();
  const api = useApi();
  const hasPageFrame = useHasPageFrameFeature();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | AttributeType>('all');
  const [page, setPage] = useState(0);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    setPage(0);
  }, [typeFilter, search]);

  function toggleFavorite(key: string) {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const sharedQuery = {
    project: selection.projects,
    environment: selection.environments,
    itemType: 'spans',
    ...normalizeDateTimeParams(selection.datetime),
  };

  const [stringResult, numberResult, booleanResult] = useQueries({
    queries: ATTRIBUTE_TYPES.map(attributeType => ({
      queryKey: ['attributes', organization.slug, attributeType, sharedQuery],
      queryFn: () =>
        api.requestPromise(
          `/organizations/${organization.slug}/trace-items/attributes/`,
          {method: 'GET', query: {...sharedQuery, attributeType}}
        ) as Promise<RawAttribute[]>,
      staleTime: 60_000,
    })),
  });

  const isLoading =
    stringResult.isPending || numberResult.isPending || booleanResult.isPending;

  const attributes = useMemo<Attribute[]>(() => {
    const seen = new Set<string>();
    const all: Attribute[] = [];

    for (const attr of stringResult.data ?? []) {
      if (!seen.has(attr.key)) {
        seen.add(attr.key);
        all.push({key: attr.key, name: attr.name, type: 'string'});
      }
    }
    for (const attr of numberResult.data ?? []) {
      if (!seen.has(attr.key)) {
        seen.add(attr.key);
        all.push({key: attr.key, name: attr.name, type: 'number'});
      }
    }
    for (const attr of booleanResult.data ?? []) {
      if (!seen.has(attr.key)) {
        seen.add(attr.key);
        all.push({key: attr.key, name: attr.name, type: 'boolean'});
      }
    }

    return all.sort((a, b) => a.name.localeCompare(b.name));
  }, [stringResult, numberResult, booleanResult]);

  const filtered = useMemo(() => {
    return attributes.filter(attr => {
      if (typeFilter !== 'all' && attr.type !== typeFilter) {
        return false;
      }
      if (search && !attr.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [attributes, typeFilter, search]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
  const rangeStart = filtered.length === 0 ? 0 : page * ITEMS_PER_PAGE + 1;
  const rangeEnd = Math.min((page + 1) * ITEMS_PER_PAGE, filtered.length);

  return (
    <SentryDocumentTitle title={t('Attributes')} orgSlug={organization.slug}>
      <PageFiltersContainer>
        {hasPageFrame ? (
          <Layout.Title>{t('Attributes')}</Layout.Title>
        ) : (
          <Layout.Header unified>
            <Layout.HeaderContent unified>
              <Layout.Title>{t('Attributes')}</Layout.Title>
            </Layout.HeaderContent>
          </Layout.Header>
        )}

        <PageBody>
          <Toolbar>
            <ToolbarLeft>
              <StyledPageFilterBar>
                <ProjectPageFilter />
                <EnvironmentPageFilter />
              </StyledPageFilterBar>
              <CompactSelect
                size="sm"
                options={DATASET_OPTIONS}
                value="spans"
                onChange={() => {}}
              />
              <CompactSelect
                size="sm"
                options={TYPE_OPTIONS}
                value={typeFilter}
                onChange={opt => setTypeFilter(opt.value)}
              />
            </ToolbarLeft>
            <SearchContainer>
              <SearchIcon>
                <IconSearch size="sm" />
              </SearchIcon>
              <SearchInput
                type="text"
                placeholder={t('Search attribute name or descriptions...')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </SearchContainer>
          </Toolbar>

          <TableWrapper>
            <TableContainer>
              <TableCard>
                <TableHead>
                  <HeadRow>
                    <StarCell as="th" />
                    <HeadCell flex={3}>{t('Attribute')}</HeadCell>
                    <HeadCell flex={5}>{t('Description')}</HeadCell>
                    <HeadCell flex={2}>{t('Type')}</HeadCell>
                    <HeadCell flex={2}>{t('Unit')}</HeadCell>
                    <HeadCell flex={2}>{t('Last Used')}</HeadCell>
                    <HeadCell flex={1}>{t('Issues')}</HeadCell>
                  </HeadRow>
                </TableHead>
                <tbody>
                  {isLoading
                    ? Array.from({length: 10}).map((_, i) => (
                        <DataRow key={i}>
                          <StarCell />
                          <DataCell flex={3}>
                            <LoadingBar width={120} />
                          </DataCell>
                          <DataCell flex={5}>
                            <LoadingBar width={200} />
                          </DataCell>
                          <DataCell flex={2}>
                            <LoadingBar width={50} />
                          </DataCell>
                          <DataCell flex={2}>
                            <LoadingBar width={60} />
                          </DataCell>
                          <DataCell flex={2}>
                            <LoadingBar width={60} />
                          </DataCell>
                          <DataCell flex={1}>
                            <LoadingBar width={24} />
                          </DataCell>
                        </DataRow>
                      ))
                    : paginated.map(attr => (
                        <DataRow key={attr.key}>
                          <StarCell
                            onClick={() => toggleFavorite(attr.key)}
                            isFavorited={favorites.has(attr.key)}
                          >
                            <IconStar
                              size="xs"
                              isSolid={favorites.has(attr.key)}
                              variant={favorites.has(attr.key) ? 'warning' : 'muted'}
                            />
                          </StarCell>
                          <DataCell flex={3}>
                            <AttributeName
                              to={normalizeUrl(
                                `/organizations/${organization.slug}/explore/attributes/${encodeURIComponent(attr.key)}/?type=${attr.type}`
                              )}
                            >
                              {attr.name}
                            </AttributeName>
                          </DataCell>
                          <DataCell flex={5}>
                            <Muted>—</Muted>
                          </DataCell>
                          <DataCell flex={2}>
                            <Tag variant={TYPE_TAG_VARIANT[attr.type]}>
                              {TYPE_DISPLAY_LABEL[attr.type]}
                            </Tag>
                          </DataCell>
                          <DataCell flex={2}>
                            <Muted>—</Muted>
                          </DataCell>
                          <DataCell flex={2}>
                            <Muted>—</Muted>
                          </DataCell>
                          <DataCell flex={1}>
                            <Muted>—</Muted>
                          </DataCell>
                        </DataRow>
                      ))}
                </tbody>
              </TableCard>
              {!isLoading && filtered.length > 0 && (
                <Pagination>
                  <PaginationInfo>
                    {rangeStart}–{rangeEnd} {t('of')} {filtered.length}
                  </PaginationInfo>
                  <Button
                    size="xs"
                    icon={<IconChevron direction="left" size="xs" />}
                    onClick={() => setPage(p => p - 1)}
                    disabled={page === 0}
                    aria-label={t('Previous page')}
                  />
                  <Button
                    size="xs"
                    icon={<IconChevron direction="right" size="xs" />}
                    onClick={() => setPage(p => p + 1)}
                    disabled={page >= totalPages - 1}
                    aria-label={t('Next page')}
                  />
                </Pagination>
              )}
            </TableContainer>
          </TableWrapper>
        </PageBody>
      </PageFiltersContainer>
    </SentryDocumentTitle>
  );
}

const PageBody = styled('div')`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;

const Toolbar = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${p => p.theme.space.md};
  padding: ${p => p.theme.space.md} ${p => p.theme.space.xl};
  background: ${p => p.theme.tokens.background.primary};
  border-bottom: 1px solid ${p => p.theme.tokens.border.primary};
`;

const ToolbarLeft = styled('div')`
  display: flex;
  align-items: center;
  gap: ${p => p.theme.space.md};
`;

const StyledPageFilterBar = styled(PageFilterBar)`
  flex-shrink: 0;
`;

const SearchContainer = styled('div')`
  position: relative;
  flex: 1;
  max-width: 560px;
`;

const SearchIcon = styled('span')`
  position: absolute;
  left: ${p => p.theme.space.lg};
  top: 50%;
  transform: translateY(-50%);
  color: ${p => p.theme.tokens.content.secondary};
  display: flex;
  align-items: center;
`;

const SearchInput = styled('input')`
  width: 100%;
  height: 36px;
  padding: 0 ${p => p.theme.space.lg} 0 ${p => p.theme.space['3xl']};
  border: 1px solid ${p => p.theme.tokens.border.primary};
  border-radius: ${p => p.theme.radius.md};
  background: ${p => p.theme.tokens.background.secondary};
  font-size: ${p => p.theme.form.md.fontSize};
  color: ${p => p.theme.tokens.content.primary};
  outline: none;

  &::placeholder {
    color: ${p => p.theme.tokens.content.secondary};
  }

  &:focus {
    border-color: ${p => p.theme.tokens.focus.default};
    box-shadow: 0 0 0 3px ${p => p.theme.tokens.focus.default};
  }
`;

const TableWrapper = styled('div')`
  flex: 1;
  padding: ${p => p.theme.space.xl};
  background: ${p => p.theme.tokens.background.primary};
  overflow: auto;
`;

const TableContainer = styled('div')`
  border: 1px solid ${p => p.theme.tokens.border.primary};
  border-radius: ${p => p.theme.radius.md};
  overflow: hidden;
  background: ${p => p.theme.tokens.background.primary};
`;

const TableCard = styled('table')`
  width: 100%;
  border-collapse: collapse;
  background: ${p => p.theme.tokens.background.primary};
  table-layout: fixed;
`;

const TableHead = styled('thead')`
  background: ${p => p.theme.tokens.background.secondary};
  border-bottom: 1px solid ${p => p.theme.tokens.border.primary};
`;

const HeadRow = styled('tr')``;

const HeadCell = styled('th')<{flex?: number}>`
  padding: 0 ${p => p.theme.space.xl};
  height: 40px;
  text-align: left;
  font-size: ${p => p.theme.form.sm.fontSize};
  font-weight: bold;
  color: ${p => p.theme.tokens.content.secondary};
  width: ${p => (p.flex ? `${p.flex * 8}%` : 'auto')};
  white-space: nowrap;
`;

const StarCell = styled('td')<{isFavorited?: boolean}>`
  width: 40px;
  padding: 0 ${p => p.theme.space.md};
  text-align: center;
  color: ${p =>
    p.isFavorited ? p.theme.tokens.content.warning : p.theme.tokens.content.secondary};
  cursor: pointer;

  &:hover {
    color: ${p => p.theme.tokens.content.primary};
  }
`;

const DataRow = styled('tr')`
  border-bottom: 1px solid ${p => p.theme.tokens.border.secondary};
  height: 44px;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: ${p => p.theme.tokens.background.secondary};
  }
`;

const DataCell = styled('td')<{flex?: number}>`
  padding: 0 ${p => p.theme.space.xl};
  font-size: ${p => p.theme.form.md.fontSize};
  color: ${p => p.theme.tokens.content.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AttributeName = styled(Link)`
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.tokens.content.accent};
`;

const Muted = styled('span')`
  color: ${p => p.theme.tokens.content.secondary};
`;

const LoadingBar = styled('div')<{width: number}>`
  height: 12px;
  width: ${p => p.width}px;
  background: ${p => p.theme.tokens.background.secondary};
  border-radius: ${p => p.theme.radius.md};
  animation: pulse 1.5s ease-in-out infinite;

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
`;

const Pagination = styled('div')`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: ${p => p.theme.space.xs};
  padding: ${p => p.theme.space.md} ${p => p.theme.space.xl};
  border-top: 1px solid ${p => p.theme.tokens.border.primary};
`;

const PaginationInfo = styled('span')`
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.tokens.content.secondary};
  margin-right: ${p => p.theme.space.xs};
`;
