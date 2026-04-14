import {useEffect, useRef} from 'react';
import debounce from 'lodash/debounce';

import {Button} from '@sentry/scraps/button';

import Feature from 'sentry/components/acl/feature';
import {ExportQueryType, useDataExport} from 'sentry/components/useDataExport';
import {t} from 'sentry/locale';

type DataExportPayload = {
  queryInfo: any;
  queryType: ExportQueryType; // TODO(ts): Formalize different possible payloads
};

interface DataExportProps {
  payload: DataExportPayload;
  children?: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
  onClick?: () => void;
  overrideFeatureFlags?: boolean;
  size?: 'xs' | 'sm' | 'md';
}

export function DataExport({
  children,
  disabled,
  payload,
  icon,
  size = 'sm',
  overrideFeatureFlags,
  onClick,
}: DataExportProps): React.ReactElement {
  const unmountedRef = useRef(false);
  const {isExportWorking, runExport} = useDataExport({
    payload,
    unmountedRef,
  });

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const handleClick = () => {
    debounce(() => {
      void runExport();
    }, 500)();
    onClick?.();
  };

  return (
    <Feature features={overrideFeatureFlags ? [] : 'organizations:discover-query'}>
      {isExportWorking ? (
        <Button
          size={size}
          priority="default"
          tooltipProps={{
            title: t(
              "You can get on with your life. We'll email you when your data's ready."
            ),
          }}
          disabled
          icon={icon}
        >
          {t("We're working on it...")}
        </Button>
      ) : (
        <Button
          onClick={handleClick}
          disabled={disabled || false}
          size={size}
          priority="default"
          tooltipProps={{
            title: t(
              "Put your data to work. Start your export and we'll email you when it's finished."
            ),
          }}
          icon={icon}
        >
          {children ? children : t('Export All to CSV')}
        </Button>
      )}
    </Feature>
  );
}
