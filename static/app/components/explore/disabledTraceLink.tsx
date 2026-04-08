import type {LocationDescriptorObject} from 'history';

import {Link} from '@sentry/scraps/link';
import {Text} from '@sentry/scraps/text';
import {Tooltip, type TooltipProps} from '@sentry/scraps/tooltip';

import {t, tct} from 'sentry/locale';

interface DisabledTraceLinkProps {
  children: React.ReactNode;
  type: 'trace' | 'span';
  similarEventsUrl?: LocationDescriptorObject | string;
}

interface DisabledTraceLinkTooltipProps extends Omit<TooltipProps, 'title'> {
  type: DisabledTraceLinkProps['type'];
  similarEventsUrl?: DisabledTraceLinkProps['similarEventsUrl'];
}

export function DisabledTraceLinkTooltip({
  children,
  type,
  similarEventsUrl,
  ...tooltipProps
}: DisabledTraceLinkTooltipProps) {
  const title =
    type === 'trace' ? (
      similarEventsUrl ? (
        <Text>
          {tct('Trace is older than 30 days. [similarLink] in the past 24 hours.', {
            similarLink: <Link to={similarEventsUrl}>{t('View similar traces')}</Link>,
          })}
        </Text>
      ) : (
        <Text>{t('Trace is older than 30 days')}</Text>
      )
    ) : similarEventsUrl ? (
      <Text>
        {tct('Span is older than 30 days. [similarLink] in the past 24 hours.', {
          similarLink: <Link to={similarEventsUrl}>{t('View similar spans')}</Link>,
        })}
      </Text>
    ) : (
      <Text>{t('Span is older than 30 days')}</Text>
    );

  return (
    <Tooltip showUnderline isHoverable {...tooltipProps} title={title}>
      {children}
    </Tooltip>
  );
}

/**
 * Renders a non-clickable, muted trace/span link with a tooltip
 * explaining that the data is older than 30 days.
 *
 * Optionally includes a "View similar traces/spans" link in the tooltip.
 */
export function DisabledTraceLink({
  children,
  type,
  similarEventsUrl,
}: DisabledTraceLinkProps) {
  return (
    <DisabledTraceLinkTooltip type={type} similarEventsUrl={similarEventsUrl}>
      <Text variant="muted" aria-disabled="true" role="link">
        {children}
      </Text>
    </DisabledTraceLinkTooltip>
  );
}
