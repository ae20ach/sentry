import {Fragment, useMemo} from 'react';
import {useTheme, type Theme} from '@emotion/react';
import styled from '@emotion/styled';
// eslint-disable-next-line no-restricted-imports
import color from 'color';

import {Container, Stack} from '@sentry/scraps/layout';
import {Text} from '@sentry/scraps/text';
import {Tooltip} from '@sentry/scraps/tooltip';

import {Placeholder} from 'sentry/components/placeholder';
import {TextOverflow} from 'sentry/components/textOverflow';
import {t} from 'sentry/locale';
import {getApiUrl} from 'sentry/utils/api/getApiUrl';
import {useApiQueries} from 'sentry/utils/queryClient';
import {useOrganization} from 'sentry/utils/useOrganization';
import type {GroupTag} from 'sentry/views/issueDetails/groupTags/useGroupTags';

const PRIORITY_TAGS = ['transaction', 'url', 'browser', 'environment'];
const MAX_GROUPS_FOR_TAGS = 10;

const tagBarColor = (index: number, theme: Theme) =>
  color(theme.chart.getColorPalette(4).at(index)).alpha(0.8).toString();

export function SupergroupTagPreview({groupIds}: {groupIds: number[]}) {
  const organization = useOrganization();
  const theme = useTheme();

  const limitedGroupIds = useMemo(
    () => groupIds.slice(0, MAX_GROUPS_FOR_TAGS),
    [groupIds]
  );

  const tagResults = useApiQueries<GroupTag[]>(
    limitedGroupIds.map(groupId => [
      getApiUrl('/organizations/$organizationIdOrSlug/issues/$issueId/tags/', {
        path: {organizationIdOrSlug: organization.slug, issueId: String(groupId)},
      }),
      {query: {limit: 4}},
    ]),
    {staleTime: 30_000, enabled: limitedGroupIds.length > 0}
  );

  const isPending = tagResults.some(r => r.isPending);

  const tagsToShow = useMemo(() => {
    const tagMap = new Map<
      string,
      {totalValues: number; valueMap: Map<string, {count: number; name: string}>}
    >();

    for (const result of tagResults) {
      if (!result.data) {
        continue;
      }
      for (const tag of result.data) {
        let entry = tagMap.get(tag.key);
        if (!entry) {
          entry = {totalValues: 0, valueMap: new Map()};
          tagMap.set(tag.key, entry);
        }
        entry.totalValues += tag.totalValues;
        for (const val of tag.topValues) {
          const existing = entry.valueMap.get(val.value);
          if (existing) {
            existing.count += val.count;
          } else {
            entry.valueMap.set(val.value, {name: val.name, count: val.count});
          }
        }
      }
    }

    const ordered: Array<{
      key: string;
      topValues: Array<{count: number; name: string; value: string}>;
      totalValues: number;
    }> = [];

    for (const key of PRIORITY_TAGS) {
      const entry = tagMap.get(key);
      if (!entry || entry.valueMap.size === 0) {
        continue;
      }
      const topValues = [...entry.valueMap.entries()]
        .map(([value, {name, count}]) => ({value, name, count}))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      ordered.push({key, totalValues: entry.totalValues, topValues});
    }

    return ordered.slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, tagResults.length]);

  if (isPending) {
    return (
      <Container padding="lg 2xl" borderBottom="muted">
        <Stack gap="md">
          <Placeholder height="14px" width="80%" />
          <Placeholder height="14px" width="60%" />
        </Stack>
      </Container>
    );
  }

  if (tagsToShow.length === 0) {
    return null;
  }

  return (
    <Container padding="lg 2xl" borderBottom="muted">
      <TagPreviewGrid>
        {tagsToShow.map(tag => {
          const topValue = tag.topValues[0];
          const topPct =
            topValue && tag.totalValues > 0
              ? (topValue.count / tag.totalValues) * 100
              : 0;
          const topPctStr = topPct < 0.5 ? '<1%' : `${Math.round(topPct)}%`;

          const segments = tag.topValues.map((val, idx) => ({
            name: val.name || t('(empty)'),
            pct: tag.totalValues > 0 ? (val.count / tag.totalValues) * 100 : 0,
            count: val.count,
            color: tagBarColor(idx, theme),
          }));

          const totalVisible = segments.reduce((sum, s) => sum + s.count, 0);
          const hasOther = totalVisible < tag.totalValues;
          const otherPct = 100 - segments.reduce((sum, s) => sum + Math.round(s.pct), 0);

          return (
            <Tooltip
              key={tag.key}
              skipWrapper
              maxWidth={360}
              title={
                <TagTooltipLegend>
                  <TagLegendTitle>{tag.key}</TagLegendTitle>
                  <TagLegendGrid>
                    {segments.map((seg, idx) => (
                      <Fragment key={idx}>
                        <TagLegendDot style={{backgroundColor: seg.color}} />
                        <TextOverflow>{seg.name}</TextOverflow>
                        <TagLegendPct>
                          {seg.pct < 0.5 ? '<1%' : `${Math.round(seg.pct)}%`}
                        </TagLegendPct>
                      </Fragment>
                    ))}
                    {hasOther && (
                      <Fragment>
                        <TagLegendDot style={{backgroundColor: theme.colors.gray200}} />
                        <TextOverflow>{t('Other')}</TextOverflow>
                        <TagLegendPct>
                          {otherPct < 0.5 ? '<1%' : `${Math.round(otherPct)}%`}
                        </TagLegendPct>
                      </Fragment>
                    )}
                  </TagLegendGrid>
                </TagTooltipLegend>
              }
            >
              <TagPreviewRow>
                <Text size="sm" bold>
                  <TextOverflow>{tag.key}</TextOverflow>
                </Text>
                <TagSegmentedBar>
                  {segments.map((seg, idx) => (
                    <TagBarSegment
                      key={idx}
                      style={{
                        width: `${seg.pct}%`,
                        backgroundColor: seg.color,
                      }}
                    />
                  ))}
                </TagSegmentedBar>
                <Text
                  size="xs"
                  variant="muted"
                  style={{textAlign: 'right', flexShrink: 0}}
                >
                  {topPctStr}
                </Text>
                <TextOverflow>{topValue?.name || t('(empty)')}</TextOverflow>
              </TagPreviewRow>
            </Tooltip>
          );
        })}
      </TagPreviewGrid>
    </Container>
  );
}

const TagPreviewGrid = styled('div')`
  display: grid;
  grid-template-columns: auto 80px min-content 1fr;
  gap: 1px;
  column-gap: ${p => p.theme.space.xs};
  font-size: ${p => p.theme.font.size.sm};
`;

const TagPreviewRow = styled('div')`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  padding: ${p => p.theme.space['2xs']} ${p => p.theme.space.sm};
  margin: 0 -${p => p.theme.space.sm};
  border-radius: ${p => p.theme.radius.md};

  &:hover {
    background: ${p => p.theme.tokens.background.tertiary};
  }
`;

const TagSegmentedBar = styled('div')`
  display: flex;
  height: 8px;
  width: 100%;
  border-radius: 3px;
  overflow: hidden;
  /* eslint-disable-next-line @sentry/scraps/use-semantic-token */
  box-shadow: inset 0 0 0 1px ${p => p.theme.tokens.border.transparent.neutral.muted};
  background: ${p => color(p.theme.colors.gray400).alpha(0.1).toString()};
`;

const TagBarSegment = styled('div')`
  height: 100%;
  min-width: 2px;
`;

const TagTooltipLegend = styled('div')`
  padding: ${p => p.theme.space.xs} ${p => p.theme.space.md};
`;

const TagLegendTitle = styled('div')`
  font-weight: 600;
  margin-bottom: ${p => p.theme.space.sm};
`;

const TagLegendGrid = styled('div')`
  display: grid;
  grid-template-columns: min-content auto min-content;
  gap: ${p => p.theme.space.xs} ${p => p.theme.space.md};
  align-items: center;
  text-align: left;
`;

const TagLegendDot = styled('div')`
  width: 10px;
  height: 10px;
  border-radius: 100%;
`;

const TagLegendPct = styled('span')`
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
`;
