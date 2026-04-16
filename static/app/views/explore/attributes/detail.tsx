import {Fragment, useState} from 'react';
import {useParams} from 'react-router-dom';
import styled from '@emotion/styled';

import {Tag} from '@sentry/scraps/badge';
import {Button} from '@sentry/scraps/button';
import {Checkbox} from '@sentry/scraps/checkbox';
import {CompactSelect} from '@sentry/scraps/compactSelect';
import {Flex, Stack} from '@sentry/scraps/layout';
import {Link} from '@sentry/scraps/link';

import type {Crumb} from 'sentry/components/breadcrumbs';
import {Breadcrumbs} from 'sentry/components/breadcrumbs';
import * as Layout from 'sentry/components/layouts/thirds';
import {SentryDocumentTitle} from 'sentry/components/sentryDocumentTitle';
import {IconInfo} from 'sentry/icons/iconInfo';
import {IconOpen} from 'sentry/icons/iconOpen';
import {IconStar} from 'sentry/icons/iconStar';
import {t} from 'sentry/locale';
import {normalizeUrl} from 'sentry/utils/url/normalizeUrl';
import {useLocation} from 'sentry/utils/useLocation';
import {useOrganization} from 'sentry/utils/useOrganization';
import {TopBar} from 'sentry/views/navigation/topBar';
import {useHasPageFrameFeature} from 'sentry/views/navigation/useHasPageFrameFeature';

type AttributeType = 'string' | 'number' | 'boolean';

const TYPE_DISPLAY_LABEL: Record<AttributeType, string> = {
  string: 'string',
  number: 'number',
  boolean: 'bool',
};

const UNIT_OPTIONS = [
  {value: '', label: t('None')},
  {value: 'seconds', label: t('seconds')},
  {value: 'milliseconds', label: t('milliseconds')},
  {value: 'microseconds', label: t('microseconds')},
  {value: 'nanoseconds', label: t('nanoseconds')},
  {value: 'bytes', label: t('bytes')},
  {value: 'kilobytes', label: t('kilobytes')},
  {value: 'megabytes', label: t('megabytes')},
];

const MOCK_STATS = [
  {label: t('Cardinality'), value: '2'},
  {label: t('Size p(50)'), value: '10kb'},
  {label: t('Size p(99)'), value: '15kb'},
  {label: t('Times Dropped'), value: '8'},
  {label: t('Last Used'), value: '12h ago'},
];

const MOCK_ISSUES = [
  {name: 'Slow DB Query', project: 'middleware.locale', status: 'Ongoing', age: '12hr'},
  {name: 'Slow DB Query', project: 'middleware.locale', status: 'Ongoing', age: '1wk'},
  {name: 'Slow DB Query', project: 'middleware.locale', status: 'Ongoing', age: '1wk'},
  {name: 'Slow DB Query', project: 'middleware.locale', status: 'Ongoing', age: '2wk'},
  {name: 'Slow DB Query', project: 'middleware.locale', status: 'Ongoing', age: '2mo'},
  {name: 'Slow DB Query', project: 'middleware.locale', status: 'Ongoing', age: '1yr'},
];

const MOCK_SPANS = [
  {id: '9284791', size: '1029kb'},
  {id: '9284791', size: '1029kb'},
  {id: '9284791', size: '1029kb'},
  {id: '9284791', size: '1029kb'},
];

const MOCK_HISTORY = [
  {event: t('Description changed'), author: 'Martha Peck', when: t('12 min ago')},
  {event: t('Description changed'), author: 'Martha Peck', when: t('12 min ago')},
  {event: t('Description changed'), author: 'Martha Peck', when: t('12 min ago')},
  {event: t('Description changed'), author: 'Martha Peck', when: t('12 min ago')},
  {event: t('Description changed'), author: 'Martha Peck', when: t('12 min ago')},
  {event: t('Description changed'), author: 'Martha Peck', when: t('12 min ago')},
];

export default function AttributeDetail() {
  const {attributeKey = ''} = useParams<{attributeKey: string}>();
  const organization = useOrganization();
  const hasPageFrame = useHasPageFrameFeature();
  const location = useLocation();
  const rawType = location.query.type as string | undefined;
  const attributeType: AttributeType =
    rawType === 'string' || rawType === 'number' || rawType === 'boolean'
      ? rawType
      : 'string';

  const [isFavorited, setIsFavorited] = useState(false);
  const [unit, setUnit] = useState('seconds');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [linkedErrors, setLinkedErrors] = useState(true);
  const [linkedSpans, setLinkedSpans] = useState(true);

  const attributesListUrl = normalizeUrl(
    `/organizations/${organization.slug}/explore/attributes/`
  );

  const crumbs: Crumb[] = [
    {to: attributesListUrl, label: t('All Attributes')},
    {label: attributeKey},
  ];

  return (
    <SentryDocumentTitle title={attributeKey} orgSlug={organization.slug}>
      <DetailPageWrapper>
        {hasPageFrame ? (
          <TopBar.Slot name="title">
            <Breadcrumbs crumbs={crumbs} />
          </TopBar.Slot>
        ) : (
          <Layout.Header unified>
            <Layout.HeaderContent unified>
              <Breadcrumbs crumbs={crumbs} />
              <Layout.Title>{attributeKey}</Layout.Title>
            </Layout.HeaderContent>
          </Layout.Header>
        )}

        <PageBody>
          <AttributeHeader>
            <Flex align="center" gap="sm">
              <StarButton
                onClick={() => setIsFavorited(f => !f)}
                isFavorited={isFavorited}
                aria-label={
                  isFavorited ? t('Remove from favorites') : t('Add to favorites')
                }
              >
                <IconStar size="sm" isSolid={isFavorited} />
              </StarButton>
              <Stack gap="xs">
                <AttributeTitle>{attributeKey}</AttributeTitle>
                <div>
                  <Tag variant="info">{TYPE_DISPLAY_LABEL[attributeType]}</Tag>
                </div>
              </Stack>
            </Flex>
            <StatsRow>
              {MOCK_STATS.map(stat => (
                <StatItem key={stat.label}>
                  <StatLabel>{stat.label}</StatLabel>
                  <StatValue>{stat.value}</StatValue>
                </StatItem>
              ))}
            </StatsRow>
          </AttributeHeader>

          <ContentGrid>
            <MainColumn>
              <Card>
                <CardTitle>{t('Metadata')}</CardTitle>
                <FormSection>
                  <FormField>
                    <FormLabel>{t('Unit')}</FormLabel>
                    <CompactSelect
                      size="sm"
                      options={UNIT_OPTIONS}
                      value={unit}
                      onChange={opt => setUnit(opt.value)}
                    />
                  </FormField>
                  <FormField>
                    <FormLabel>{t('Description')}</FormLabel>
                    <StyledTextarea
                      rows={2}
                      placeholder={t('Add a description...')}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                    />
                  </FormField>
                  <FormField>
                    <FormLabel>{t('URL')}</FormLabel>
                    <InputWrapper>
                      <StyledInput
                        type="text"
                        placeholder="https://"
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                      />
                      <InputAdornment>
                        <IconInfo size="sm" />
                      </InputAdornment>
                    </InputWrapper>
                  </FormField>
                  <FormField>
                    <Flex align="center" gap="xs">
                      <FormLabel as="span">{t('Linked Datasets')}</FormLabel>
                      <IconInfo size="xs" />
                    </Flex>
                    <Stack gap="sm">
                      <CheckboxRow>
                        <Checkbox
                          checked={linkedErrors}
                          onChange={e => setLinkedErrors(e.target.checked)}
                        />
                        <CheckboxLabel>{t('Errors')}</CheckboxLabel>
                      </CheckboxRow>
                      <CheckboxRow>
                        <Checkbox
                          checked={linkedSpans}
                          onChange={e => setLinkedSpans(e.target.checked)}
                        />
                        <CheckboxLabel>{t('Spans')}</CheckboxLabel>
                      </CheckboxRow>
                    </Stack>
                  </FormField>
                </FormSection>
                <Button priority="primary" size="sm">
                  {t('Save Changes')}
                </Button>
              </Card>

              <Card>
                <CardHeaderRow>
                  <Flex align="center" gap="xs">
                    <CardTitleInline>{t('Attribute Values')}</CardTitleInline>
                    <Muted>
                      <IconOpen size="xs" />
                    </Muted>
                  </Flex>
                  <Flex align="center" gap="md">
                    <Muted>{t('Bar Chart')}</Muted>
                    <Muted>{t('30 minutes')}</Muted>
                  </Flex>
                </CardHeaderRow>
                <ChartPlaceholder />
                <ExtrapolatedNote>{t('Extrapolated from 900 metrics')}</ExtrapolatedNote>
              </Card>

              <Card>
                <CardHeaderRow>
                  <Flex align="center" gap="xs">
                    <CardTitleInline>{t('Related Issues')}</CardTitleInline>
                    <Muted>
                      <IconOpen size="xs" />
                    </Muted>
                  </Flex>
                </CardHeaderRow>
                <IssueList>
                  {MOCK_ISSUES.map((issue, i) => (
                    <IssueRow key={i}>
                      <IssueNameLink to="#">{issue.name}</IssueNameLink>
                      <Muted>{issue.project}</Muted>
                      <Muted>{issue.status}</Muted>
                      <IssueAge>{issue.age}</IssueAge>
                    </IssueRow>
                  ))}
                </IssueList>
                <Fragment>
                  <AccentLink to="#">{t('+ 12 more')}</AccentLink>
                </Fragment>
              </Card>
            </MainColumn>

            <SidebarColumn>
              <Card>
                <CardHeaderRow>
                  <Flex align="center" gap="xs">
                    <CardTitleInline>{t('Truncated Spans')}</CardTitleInline>
                    <Muted>
                      <IconOpen size="xs" />
                    </Muted>
                  </Flex>
                </CardHeaderRow>
                <WarningText>{t('Hidden 3 times in the last 90 days')}</WarningText>
                <SpanList>
                  {MOCK_SPANS.map((span, i) => (
                    <SpanRow key={i}>
                      <AccentLink to="#">{span.id}</AccentLink>
                      <Muted>{span.size}</Muted>
                    </SpanRow>
                  ))}
                </SpanList>
              </Card>

              <Card>
                <CardTitle>{t('Attribute History')}</CardTitle>
                <HistoryList>
                  {MOCK_HISTORY.map((item, i) => (
                    <HistoryRow key={i}>
                      <HistoryEventText>{item.event}</HistoryEventText>
                      <Flex justify="between">
                        <Muted>{item.author}</Muted>
                        <Muted>{item.when}</Muted>
                      </Flex>
                    </HistoryRow>
                  ))}
                </HistoryList>
              </Card>
            </SidebarColumn>
          </ContentGrid>
        </PageBody>
      </DetailPageWrapper>
    </SentryDocumentTitle>
  );
}

const DetailPageWrapper = styled('div')`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;

const PageBody = styled('div')`
  flex: 1;
  overflow: auto;
  background: ${p => p.theme.tokens.background.secondary};
`;

const AttributeHeader = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${p => p.theme.space.xl};
  background: ${p => p.theme.tokens.background.primary};
  border-bottom: 1px solid ${p => p.theme.tokens.border.primary};
`;

const StarButton = styled('button')<{isFavorited?: boolean}>`
  background: none;
  border: none;
  padding: ${p => p.theme.space.xs};
  cursor: pointer;
  color: ${p =>
    p.isFavorited ? p.theme.tokens.content.warning : p.theme.tokens.content.secondary};
  display: flex;
  align-items: center;

  &:hover {
    color: ${p => p.theme.tokens.content.primary};
  }
`;

const AttributeTitle = styled('div')`
  font-size: ${p => p.theme.font.size.xl};
  font-weight: bold;
  color: ${p => p.theme.tokens.content.primary};
`;

const StatsRow = styled('div')`
  display: flex;
  align-items: center;
  gap: ${p => p.theme.space.xl};
`;

const StatItem = styled('div')`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: ${p => p.theme.space.xs};
`;

const StatLabel = styled('span')`
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.tokens.content.secondary};
`;

const StatValue = styled('span')`
  font-size: ${p => p.theme.font.size.xl};
  font-weight: bold;
  color: ${p => p.theme.tokens.content.primary};
`;

const ContentGrid = styled('div')`
  display: flex;
  gap: ${p => p.theme.space.xl};
  padding: ${p => p.theme.space.xl};
  align-items: flex-start;
`;

const MainColumn = styled('div')`
  flex: 3;
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.xl};
  min-width: 0;
`;

const SidebarColumn = styled('div')`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.xl};
  min-width: 0;
`;

const Card = styled('div')`
  background: ${p => p.theme.tokens.background.primary};
  border: 1px solid ${p => p.theme.tokens.border.primary};
  border-radius: ${p => p.theme.radius.md};
  padding: ${p => p.theme.space.xl};
`;

const CardHeaderRow = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${p => p.theme.space.lg};
`;

const CardTitle = styled('div')`
  font-size: ${p => p.theme.form.md.fontSize};
  font-weight: bold;
  color: ${p => p.theme.tokens.content.primary};
  margin-bottom: ${p => p.theme.space.lg};
`;

const CardTitleInline = styled('div')`
  font-size: ${p => p.theme.form.md.fontSize};
  font-weight: bold;
  color: ${p => p.theme.tokens.content.primary};
`;

const FormSection = styled('div')`
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.lg};
  margin-bottom: ${p => p.theme.space.xl};
`;

const FormField = styled('div')`
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.xs};
`;

const FormLabel = styled('label')`
  font-size: ${p => p.theme.form.sm.fontSize};
  font-weight: 600;
  color: ${p => p.theme.tokens.content.primary};
`;

const StyledInput = styled('input')`
  width: 100%;
  height: 36px;
  padding: 0 ${p => p.theme.space['3xl']} 0 ${p => p.theme.space.lg};
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

const StyledTextarea = styled('textarea')`
  width: 100%;
  padding: ${p => p.theme.space.md} ${p => p.theme.space.lg};
  border: 1px solid ${p => p.theme.tokens.border.primary};
  border-radius: ${p => p.theme.radius.md};
  background: ${p => p.theme.tokens.background.secondary};
  font-size: ${p => p.theme.form.md.fontSize};
  color: ${p => p.theme.tokens.content.primary};
  font-family: inherit;
  resize: vertical;
  outline: none;

  &::placeholder {
    color: ${p => p.theme.tokens.content.secondary};
  }

  &:focus {
    border-color: ${p => p.theme.tokens.focus.default};
    box-shadow: 0 0 0 3px ${p => p.theme.tokens.focus.default};
  }
`;

const InputWrapper = styled('div')`
  position: relative;
`;

const InputAdornment = styled('span')`
  position: absolute;
  right: ${p => p.theme.space.lg};
  top: 50%;
  transform: translateY(-50%);
  color: ${p => p.theme.tokens.content.secondary};
  display: flex;
  align-items: center;
  pointer-events: none;
`;

const CheckboxRow = styled('div')`
  display: flex;
  align-items: center;
  gap: ${p => p.theme.space.sm};
`;

const CheckboxLabel = styled('span')`
  font-size: ${p => p.theme.form.md.fontSize};
  color: ${p => p.theme.tokens.content.primary};
`;

const ChartPlaceholder = styled('div')`
  height: 240px;
  background: ${p => p.theme.tokens.background.secondary};
  border-radius: ${p => p.theme.radius.md};
  margin-top: ${p => p.theme.space.md};
`;

const ExtrapolatedNote = styled('span')`
  display: block;
  margin-top: ${p => p.theme.space.sm};
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.tokens.content.secondary};
`;

const IssueList = styled('div')`
  display: flex;
  flex-direction: column;
`;

const IssueRow = styled('div')`
  display: flex;
  align-items: center;
  gap: ${p => p.theme.space.lg};
  padding: ${p => p.theme.space.sm} 0;
  border-bottom: 1px solid ${p => p.theme.tokens.border.secondary};

  &:last-child {
    border-bottom: none;
  }
`;

const IssueNameLink = styled(Link)`
  flex: 1;
  color: ${p => p.theme.tokens.content.accent};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: ${p => p.theme.form.sm.fontSize};
`;

const IssueAge = styled('span')`
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.tokens.content.secondary};
  min-width: 36px;
  text-align: right;
`;

const AccentLink = styled(Link)`
  display: block;
  margin-top: ${p => p.theme.space.md};
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.tokens.content.accent};
`;

const SpanList = styled('div')`
  display: flex;
  flex-direction: column;
  margin-top: ${p => p.theme.space.sm};
`;

const SpanRow = styled('div')`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${p => p.theme.space.xs} 0;
`;

const WarningText = styled('span')`
  display: block;
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.colors.red500};
  margin-top: ${p => p.theme.space.xs};
  margin-bottom: ${p => p.theme.space.sm};
`;

const HistoryList = styled('div')`
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.md};
`;

const HistoryRow = styled('div')`
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.xs};
`;

const HistoryEventText = styled('span')`
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.tokens.content.primary};
`;

const Muted = styled('span')`
  font-size: ${p => p.theme.form.sm.fontSize};
  color: ${p => p.theme.tokens.content.secondary};
`;
