import {Button, ButtonBar} from '@sentry/scraps/button';
import {Flex, type FlexProps} from '@sentry/scraps/layout';
import {Text} from '@sentry/scraps/text';

import {IconChevron} from 'sentry/icons';
import {t} from 'sentry/locale';

export type PaginationFooterSize = 'normal' | 'small';

type Props = {
  isNextDisabled: boolean;
  isPreviousDisabled: boolean;
  onNext: () => void;
  onPrevious: () => void;
  /**
   * When set, overrides the default button size implied by `size` (e.g. pass through
   * legacy `Pagination` `size` values: zero | xs | sm | md).
   */
  buttonSize?: React.ComponentProps<typeof Button>['size'];
  caption?: React.ReactNode;
  paginationAnalyticsEvent?: (direction: string) => void;
  /**
   * `normal` matches the default Issues stream footer (larger caption).
   * `small` is for compact footers (e.g. nested tables, side panels).
   */
  size?: PaginationFooterSize;
} & Omit<FlexProps<'div'>, 'align' | 'children' | 'justify'>;

const SIZE_STYLES: Record<
  PaginationFooterSize,
  {
    defaultButtonSize: React.ComponentProps<typeof Button>['size'];
    gap: React.ComponentProps<typeof Flex>['gap'];
    textSize: React.ComponentProps<typeof Text>['size'];
  }
> = {
  normal: {
    defaultButtonSize: 'sm',
    gap: 'xl',
    textSize: 'md',
  },
  small: {
    defaultButtonSize: 'xs',
    gap: 'sm',
    textSize: 'sm',
  },
};

/**
 * Right-aligned range/count label with previous/next icon buttons.
 * Use with cursor-based navigation (`Pagination`) or client-side page state.
 */
export function PaginationFooter({
  isNextDisabled,
  isPreviousDisabled,
  onNext,
  onPrevious,
  buttonSize: buttonSizeProp,
  caption,
  paginationAnalyticsEvent,
  size = 'normal',
  ...flexProps
}: Props) {
  const {defaultButtonSize, gap, textSize} = SIZE_STYLES[size];
  const buttonSize = buttonSizeProp ?? defaultButtonSize;

  return (
    <Flex align="center" data-test-id="pagination" gap={gap} justify="end" {...flexProps}>
      {caption ? (
        <Text size={textSize} variant="muted">
          {caption}
        </Text>
      ) : null}
      <ButtonBar>
        <Button
          aria-label={t('Previous')}
          disabled={isPreviousDisabled}
          icon={<IconChevron direction="left" />}
          size={buttonSize}
          onClick={() => {
            onPrevious();
            paginationAnalyticsEvent?.('Previous');
          }}
        />
        <Button
          aria-label={t('Next')}
          disabled={isNextDisabled}
          icon={<IconChevron direction="right" />}
          size={buttonSize}
          onClick={() => {
            onNext();
            paginationAnalyticsEvent?.('Next');
          }}
        />
      </ButtonBar>
    </Flex>
  );
}
