import {downloadFromHref} from 'sentry/utils/downloadFromHref';
import {createLogDownloadFilename} from 'sentry/views/explore/logs/createLogDownloadFilename';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';

export function downloadLogsAsJson(tableData: OurLogsResponseItem[], filename: string) {
  const jsonContent = JSON.stringify(tableData);
  const encodedDataUrl = `data:application/json;charset=utf8,${encodeURIComponent(jsonContent)}`;

  downloadFromHref(createLogDownloadFilename(filename, 'json'), encodedDataUrl);
}
