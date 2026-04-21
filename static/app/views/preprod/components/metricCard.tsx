import {Button} from '@sentry/scraps/button';
import {Flex, Stack} from '@sentry/scraps/layout';
import {Text} from '@sentry/scraps/text';
import {Tooltip} from '@sentry/scraps/tooltip';

interface MetricCardAction {
  ariaLabel: string;
  icon: React.ReactNode;
  onClick: () => void;
  tooltip: React.ReactNode;
}

interface MetricCardProps {
  children: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  labelTooltip: React.ReactNode;
  action?: MetricCardAction;
  style?: React.CSSProperties;
}

export function MetricCard(props: MetricCardProps) {
  const {icon, label, labelTooltip, action, children, style} = props;

  return (
    <Stack
      background="primary"
      radius="lg"
      padding="xl"
      gap="xs"
      border="primary"
      flex="1"
      style={style}
      minWidth="300px"
    >
      <Flex align="center" justify="between" gap="sm">
        <Flex gap="sm" align="center">
          {icon}
          {labelTooltip ? (
            <Tooltip title={labelTooltip}>
              <Text variant="muted" size="sm" bold uppercase>
                {label}
              </Text>
            </Tooltip>
          ) : (
            <Text variant="muted" size="sm" bold uppercase>
              {label}
            </Text>
          )}
        </Flex>
        {action && (
          <Button
            size="xs"
            priority="link"
            icon={action.icon}
            aria-label={action.ariaLabel}
            tooltipProps={{title: action.tooltip}}
            onClick={action.onClick}
          />
        )}
      </Flex>
      {children}
    </Stack>
  );
}
