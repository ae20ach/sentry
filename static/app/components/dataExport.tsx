import {useCallback, useEffect, useRef, useState} from 'react';
import debounce from 'lodash/debounce';

import {Button} from '@sentry/scraps/button';

import {addErrorMessage, addSuccessMessage} from 'sentry/actionCreators/indicator';
import Feature from 'sentry/components/acl/feature';
import {t} from 'sentry/locale';
import {useApi} from 'sentry/utils/useApi';
import {useOrganization} from 'sentry/utils/useOrganization';

// NOTE: Coordinate with other ExportQueryType (src/sentry/data_export/base.py)
export enum ExportQueryType {
  ISSUES_BY_TAG = 'Issues-by-Tag',
  DISCOVER = 'Discover',
  EXPLORE = 'Explore',
}

export type DataExportPayload = {
  queryInfo: any;
  queryType: ExportQueryType; // TODO(ts): Formalize different possible payloads
};

export type DataExportInvokeOptions = {
  limit?: number;
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

export function useDataExport({
  payload,
  inProgressCallback,
  unmountedRef,
}: {
  payload: DataExportPayload;
  inProgressCallback?: (inProgress: boolean) => void;
  unmountedRef?: React.RefObject<boolean>;
}) {
  const organization = useOrganization();
  const api = useApi();

  return useCallback(
    async (invokeOptions?: DataExportInvokeOptions): Promise<boolean> => {
      inProgressCallback?.(true);

      const data: {
        query_info: any;
        query_type: ExportQueryType;
        limit?: number;
      } = {
        query_type: payload.queryType,
        query_info: payload.queryInfo,
      };
      if (typeof invokeOptions?.limit === 'number') {
        data.limit = invokeOptions.limit;
      }

      try {
        const [_data, _, response] = await api.requestPromise(
          `/organizations/${organization.slug}/data-export/`,
          {
            includeAllArgs: true,
            method: 'POST',
            data,
          }
        );
        if (unmountedRef?.current) {
          return false;
        }

        addSuccessMessage(
          response?.status === 201
            ? t(
                "Sit tight. We'll shoot you an email when your data is ready for download."
              )
            : t("It looks like we're already working on it. Sit tight, we'll email you.")
        );
        return true;
      } catch (err: unknown) {
        if (unmountedRef?.current) {
          return false;
        }
        const message =
          (err as {responseJSON?: {detail?: string}})?.responseJSON?.detail ??
          t(
            "We tried our hardest, but we couldn't export your data. Give it another go."
          );

        addErrorMessage(message);
        inProgressCallback?.(false);
        return false;
      }
    },
    [
      payload.queryInfo,
      payload.queryType,
      organization.slug,
      api,
      inProgressCallback,
      unmountedRef,
    ]
  );
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
  const [inProgress, setInProgress] = useState(false);
  const handleDataExport = useDataExport({
    payload,
    unmountedRef,
    inProgressCallback: setInProgress,
  });

  // We clear the indicator if export props change so that the user
  // can fire another export without having to wait for the previous one to finish.
  useEffect(() => {
    if (inProgress) {
      setInProgress(false);
    }
    // We are skipping the inProgress dependency because it would have fired on each handleDataExport
    // call and would have immediately turned off the value giving users no feedback on their click action.
    // An alternative way to handle this would have probably been to key the component by payload/queryType,
    // but that seems like it can be a complex object so tracking changes could result in very brittle behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.queryType, payload.queryInfo]);

  // Tracking unmounting of the component to prevent setState call on unmounted component
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const handleClick = () => {
    debounce(handleDataExport, 500)();
    onClick?.();
  };

  return (
    <Feature features={overrideFeatureFlags ? [] : 'organizations:discover-query'}>
      {inProgress ? (
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
