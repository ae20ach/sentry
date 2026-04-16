import {useMemo, useState} from 'react';
import styled from '@emotion/styled';
import {useQueries} from '@tanstack/react-query';

import {Tag} from '@sentry/scraps/badge';
import {CompactSelect} from '@sentry/scraps/compactSelect';

import * as Layout from 'sentry/components/layouts/thirds';
import {PageFiltersContainer} from 'sentry/components/pageFilters/container';
import {EnvironmentPageFilter} from 'sentry/components/pageFilters/environment/environmentPageFilter';
import {normalizeDateTimeParams} from 'sentry/components/pageFilters/parse';
import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {SentryDocumentTitle} from 'sentry/components/sentryDocumentTitle';
import {IconSearch} from 'sentry/icons/iconSearch';
import {IconStar} from 'sentry/icons/iconStar';
import {t} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import {useApi} from 'sentry/utils/useApi';
import {useOrganization} from 'sentry/utils/useOrganization';

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
  {value: 'boolean' as const, label: t('boolean')},
];

const ATTRIBUTE_TYPES: AttributeType[] = ['string', 'number', 'boolean'];

export default function AttributesContent() {
  const organization = useOrganization();
  const {selection} = usePageFilters();
  const api = useApi();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | AttributeType>('all');

  const sharedQuery = {
    project: selection.projects,
    itemType: 'spans',
    ...normalizeDateTimeParams(selection.datetime),
  };

  const results = useQueries({
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

  const isLoading = results.some(r => r.isPending);

  const attributes = useMemo<Attribute[]>(() => {
    const seen = new Set<string>();
    const all: Attribute[] = [];

    ATTRIBUTE_TYPES.forEach((type, i) => {
      const data = results[i]?.data ?? [];
      for (const attr of data) {
        if (!seen.has(attr.key)) {
          seen.add(attr.key);
          all.push({key: attr.key, name: attr.name, type});
        }
      }
    });

    return all.sort((a, b) => a.name.localeCompare(b.name));
  }, [results]);

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

  return (
    <SentryDocumentTitle title={t('Attributes')} orgSlug={organization.slug}>
      <PageFiltersContainer>
        <Layout.Header unified>
          <Layout.HeaderContent unified>
            <Layout.Title>{t('Attributes')}</Layout.Title>
          </Layout.HeaderContent>
        </Layout.Header>

        <PageBody>
          <Toolbar>
            <ToolbarLeft>
              <EnvironmentPageFilter />
              <CompactSelect
                size="sm"
                options={TYPE_OPTIONS}
                value={typeFilter}
                onChange={opt => setTypeFilter(opt.value)}
                triggerLabel={
                  typeFilter === 'all' ? t('Type: All') : t('Type: %s', typeFilter)
                }
                triggerProps={{prefix: null}}
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
            <TableCard>
              <TableHead>
                <HeadRow>
                  <StarCell />
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
                  : filtered.map(attr => (
                      <DataRow key={attr.key}>
                        <StarCell>
                          <IconStar size="xs" color="gray200" />
                        </StarCell>
                        <DataCell flex={3}>
                          <AttributeName>{attr.name}</AttributeName>
                        </DataCell>
                        <DataCell flex={5}>
                          <Muted>—</Muted>
                        </DataCell>
                        <DataCell flex={2}>
                          <Tag variant="info">{attr.type}</Tag>
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
  gap: ${space(1)};
  padding: ${space(1)} ${space(2)};
  background: ${p => p.theme.tokens.background.primary};
  border-bottom: 1px solid ${p => p.theme.tokens.border.primary};
`;

const ToolbarLeft = styled('div')`
  display: flex;
  align-items: center;
  gap: ${space(1)};
`;

const SearchContainer = styled('div')`
  position: relative;
  flex: 1;
  max-width: 560px;
`;

const SearchIcon = styled('span')`
  position: absolute;
  left: ${space(1.5)};
  top: 50%;
  transform: translateY(-50%);
  color: ${p => p.theme.tokens.content.secondary};
  display: flex;
  align-items: center;
`;

const SearchInput = styled('input')`
  width: 100%;
  height: 36px;
  padding: 0 ${space(1.5)} 0 ${space(4)};
  border: 1px solid ${p => p.theme.tokens.border.primary};
  border-radius: ${p => p.theme.radius.md};
  background: ${p => p.theme.tokens.background.secondary};
  box-shadow: inset 0 2px 0 0 ${p => p.theme.tokens.border.primary};
  font-size: ${p => p.theme.form.md.fontSize};
  color: ${p => p.theme.tokens.content.primary};
  outline: none;

  &::placeholder {
    color: ${p => p.theme.tokens.content.secondary};
  }

  &:focus {
    border-color: ${p => p.theme.tokens.focus.default};
    box-shadow:
      inset 0 2px 0 0 ${p => p.theme.tokens.border.primary},
      0 0 0 3px ${p => p.theme.tokens.focus.default};
  }
`;

const TableWrapper = styled('div')`
  flex: 1;
  padding: ${space(2)};
  background: ${p => p.theme.tokens.background.secondary};
  overflow: auto;
`;

const TableCard = styled('table')`
  width: 100%;
  border-collapse: collapse;
  background: ${p => p.theme.tokens.background.primary};
  border: 1px solid ${p => p.theme.tokens.border.primary};
  border-radius: ${p => p.theme.radius.md};
  overflow: hidden;
  table-layout: fixed;
`;

const TableHead = styled('thead')`
  background: ${p => p.theme.tokens.background.secondary};
  border-bottom: 1px solid ${p => p.theme.tokens.border.primary};
`;

const HeadRow = styled('tr')``;

const HeadCell = styled('th')<{flex?: number}>`
  padding: 0 ${space(2)};
  height: 40px;
  text-align: left;
  font-size: ${p => p.theme.form.sm.fontSize};
  font-weight: bold;
  color: ${p => p.theme.tokens.content.secondary};
  width: ${p => (p.flex ? `${p.flex * 8}%` : 'auto')};
  white-space: nowrap;
`;

const StarCell = styled('td')`
  width: 40px;
  padding: 0 ${space(1)};
  text-align: center;
  color: ${p => p.theme.tokens.content.secondary};
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
  padding: 0 ${space(2)};
  font-size: ${p => p.theme.form.md.fontSize};
  color: ${p => p.theme.tokens.content.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AttributeName = styled('span')`
  font-family: ${p => p.theme.font.family.mono};
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.tokens.content.primary};
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
