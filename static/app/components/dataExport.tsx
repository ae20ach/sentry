import {useCallback, useEffect, useRef} from 'react';
import debounce from 'lodash/debounce';

import {Button} from '@sentry/scraps/button';

import {addErrorMessage, addSuccessMessage} from 'sentry/actionCreators/indicator';
import Feature from 'sentry/components/acl/feature';
import {t} from 'sentry/locale';
import {fetchMutationWithStatus, useMutation} from 'sentry/utils/queryClient';
import {RequestError} from 'sentry/utils/requestError/requestError';
import {useOrganization} from 'sentry/utils/useOrganization';
import type {OurLogFieldKey} from 'sentry/views/explore/logs/types';

// NOTE: Coordinate with other ExportQueryType (src/sentry/data_export/base.py)
export enum ExportQueryType {
  ISSUES_BY_TAG = 'Issues-by-Tag',
  DISCOVER = 'Discover',
  EXPLORE = 'Explore',
}

export interface LogsQueryInfo {
  dataset: 'logs';
  field: OurLogFieldKey[];
  project: number[];
  query: string;
  sort: string[];
  end?: string;
  environment?: string[];
  start?: string;
  statsPeriod?: string;
}

type DataExportPayload = {
  queryInfo: any;
  queryType: ExportQueryType; // TODO(ts): Formalize different possible payloads
};

type DataExportInvokeOptions = {
  allColumns: boolean;
  format: 'csv' | 'json';
  limit: number;
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

function getDataExportErrorMessage(error: unknown): string {
  if (error instanceof RequestError) {
    const detail = error.responseJSON?.detail;
    if (typeof detail === 'string') {
      return detail;
    }
  }
  return t("We tried our hardest, but we couldn't export your data. Give it another go.");
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

  const mutation = useMutation({
    mutationFn: (invokeOptions?: DataExportInvokeOptions) => {
      const data: Record<string, unknown> = {
        query_type: payload.queryType,
        query_info: payload.queryInfo,
      };
      if (typeof invokeOptions?.limit === 'number') {
        data.limit = invokeOptions.limit;
      }

      return fetchMutationWithStatus({
        method: 'POST',
        url: `/organizations/${organization.slug}/data-export/`,
        data,
      });
    },
    onMutate: () => {
      inProgressCallback?.(true);
    },
    onSuccess: result => {
      if (unmountedRef?.current) {
        return;
      }
      addSuccessMessage(
        result.statusCode === 201
          ? t("Sit tight. We'll shoot you an email when your data is ready for download.")
          : t("It looks like we're already working on it. Sit tight, we'll email you.")
      );
    },
    onError: (error: unknown) => {
      if (unmountedRef?.current) {
        return;
      }
      addErrorMessage(getDataExportErrorMessage(error));
      inProgressCallback?.(false);
    },
  });

  const {reset} = mutation;

  useEffect(() => {
    reset();
  }, [payload.queryInfo, payload.queryType, reset]);

  const runExport = useCallback(
    async (invokeOptions?: DataExportInvokeOptions): Promise<boolean> => {
      try {
        await mutation.mutateAsync(invokeOptions);
        if (unmountedRef?.current) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    [mutation, unmountedRef]
  );

  const isExportWorking = mutation.isPending || mutation.isSuccess;

  return {isExportWorking, mutation, runExport};
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
