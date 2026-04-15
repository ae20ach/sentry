import {downloadLogsAsCsv} from 'sentry/views/explore/logs/downloadLogsAsCsv';
import {downloadLogsAsJson} from 'sentry/views/explore/logs/downloadLogsAsJson';
import type {OurLogFieldKey, OurLogsResponseItem} from 'sentry/views/explore/logs/types';

interface DownloadLogsOptions {
  fields: OurLogFieldKey[];
  filename: string;
  format: 'csv' | 'json';
  tableData: OurLogsResponseItem[];
  limit?: number;
}

export function downloadLogs({
  format,
  tableData,
  fields,
  filename,
  limit,
}: DownloadLogsOptions) {
  switch (format) {
    case 'csv':
      return downloadLogsAsCsv(tableData.slice(0, limit), fields, filename);
    case 'json':
      return downloadLogsAsJson(tableData, filename);
  }
}
