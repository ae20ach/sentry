import {downloadFromHref} from 'sentry/utils/downloadFromHref';
import {createLogDownloadFilename} from 'sentry/views/explore/logs/createLogDownloadFilename';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';

export function downloadLogsAsJsonl(tableData: OurLogsResponseItem[], filename: string) {
  const jsonlContent = tableData.map(datum => JSON.stringify(datum)).join('\n');
  const encodedDataUrl = `data:application/jsonl;charset=utf8,${encodeURIComponent(jsonlContent)}`;

  downloadFromHref(createLogDownloadFilename(filename, 'jsonl'), encodedDataUrl);
}
