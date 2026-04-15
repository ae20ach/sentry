import {downloadLogs} from 'sentry/views/explore/logs/downloadLogs';
import {OurLogKnownFieldKey} from 'sentry/views/explore/logs/types';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';

const mockDownloadLogsAsCsv = jest.fn();

jest.mock('sentry/views/explore/logs/downloadLogsAsCsv', () => ({
  get downloadLogsAsCsv() {
    return mockDownloadLogsAsCsv;
  },
}));

const mockDownloadLogsAsJson = jest.fn();

jest.mock('sentry/views/explore/logs/downloadLogsAsJson', () => ({
  get downloadLogsAsJson() {
    return mockDownloadLogsAsJson;
  },
}));

const fields = [OurLogKnownFieldKey.MESSAGE];
const filename = 'logs-export';

const row = (message: string) =>
  ({[OurLogKnownFieldKey.MESSAGE]: message}) as OurLogsResponseItem;

describe('downloadLogs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to downloadLogsAsCsv with limited rows when format is csv', () => {
    const tableData = [row('a'), row('b'), row('c')];
    const expected = 'csv-result';
    mockDownloadLogsAsCsv.mockReturnValue(expected);

    const result = downloadLogs({
      format: 'csv',
      tableData,
      fields,
      filename,
      limit: 2,
    });

    expect(mockDownloadLogsAsCsv).toHaveBeenCalledTimes(1);
    expect(mockDownloadLogsAsCsv).toHaveBeenCalledWith(
      [row('a'), row('b')],
      fields,
      filename
    );
    expect(mockDownloadLogsAsJson).not.toHaveBeenCalled();
    expect(result).toBe(expected);
  });

  it('delegates to downloadLogsAsJson when format is json', () => {
    const tableData = [row('a'), row('b'), row('c')];
    const expected = 'json-result';
    mockDownloadLogsAsJson.mockReturnValue(expected);

    const result = downloadLogs({
      format: 'json',
      tableData,
      fields,
      filename,
      limit: 2,
    });

    expect(mockDownloadLogsAsJson).toHaveBeenCalledTimes(1);
    expect(mockDownloadLogsAsJson).toHaveBeenCalledWith(tableData, filename);
    expect(mockDownloadLogsAsCsv).not.toHaveBeenCalled();
    expect(result).toBe(expected);
  });
});
