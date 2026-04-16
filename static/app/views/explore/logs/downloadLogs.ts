import type {DataExportFormat} from 'sentry/components/exports/useDataExport';
import {downloadLogsAsCsv} from 'sentry/views/explore/logs/downloadLogsAsCsv';
import {downloadLogsAsJsonl} from 'sentry/views/explore/logs/downloadLogsAsJsonl';
import type {OurLogFieldKey, OurLogsResponseItem} from 'sentry/views/explore/logs/types';

interface DownloadLogsOptions {
  fields: OurLogFieldKey[];
  filename: string;
  format: DataExportFormat;
  rows: OurLogsResponseItem[];
}

export function downloadLogs({fields, filename, format, rows}: DownloadLogsOptions) {
  switch (format) {
    case 'csv':
      return downloadLogsAsCsv(rows, fields, filename);
    case 'jsonl':
      return downloadLogsAsJsonl(rows, filename);
  }
}
