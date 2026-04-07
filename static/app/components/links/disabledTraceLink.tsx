import type {LocationDescriptorObject} from 'history';

import {Link} from '@sentry/scraps/link';
import {Text} from '@sentry/scraps/text';
import {Tooltip} from '@sentry/scraps/tooltip';

import {t, tct} from 'sentry/locale';

interface DisabledTraceLinkProps {
  children: React.ReactNode;
  type: 'trace' | 'span';
  similarEventsUrl?: LocationDescriptorObject | string;
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
  let tooltipContent: React.ReactNode;

  if (type === 'trace') {
    tooltipContent = similarEventsUrl ? (
      <Text>
        {tct('Trace is older than 30 days. [similarLink] in the past 24 hours.', {
          similarLink: <Link to={similarEventsUrl}>{t('View similar traces')}</Link>,
        })}
      </Text>
    ) : (
      <Text>{t('Trace is older than 30 days')}</Text>
    );
  } else {
    tooltipContent = similarEventsUrl ? (
      <Text>
        {tct('Span is older than 30 days. [similarLink] in the past 24 hours.', {
          similarLink: <Link to={similarEventsUrl}>{t('View similar spans')}</Link>,
        })}
      </Text>
    ) : (
      <Text>{t('Span is older than 30 days')}</Text>
    );
  }

  return (
    <Tooltip showUnderline isHoverable title={tooltipContent}>
      <Text variant="muted" aria-disabled="true" role="link">
        {children}
      </Text>
    </Tooltip>
  );
}
