import type {DataExportFormat} from 'sentry/components/exports/useDataExport';
import {downloadLogsAsCsv} from 'sentry/views/explore/logs/downloadLogsAsCsv';
import {downloadLogsAsJsonl} from 'sentry/views/explore/logs/downloadLogsAsJsonl';
import type {OurLogFieldKey, OurLogsResponseItem} from 'sentry/views/explore/logs/types';

interface DownloadLogsOptions {
  fields: OurLogFieldKey[];
  filename: string;
  format: DataExportFormat;
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
    case 'jsonl':
      return downloadLogsAsJsonl(tableData, filename);
  }
}
