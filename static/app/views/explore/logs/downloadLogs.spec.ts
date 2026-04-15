import {downloadLogs} from 'sentry/views/explore/logs/downloadLogs';
import {OurLogKnownFieldKey} from 'sentry/views/explore/logs/types';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';

const mockDownloadLogsAsCsv = jest.fn();

jest.mock('sentry/views/explore/logs/downloadLogsAsCsv', () => ({
  get downloadLogsAsCsv() {
    return mockDownloadLogsAsCsv;
  },
}));

const mockDownloadLogsAsJsonl = jest.fn();

jest.mock('sentry/views/explore/logs/downloadLogsAsJsonl', () => ({
  get downloadLogsAsJsonl() {
    return mockDownloadLogsAsJsonl;
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
    expect(mockDownloadLogsAsJsonl).not.toHaveBeenCalled();
    expect(result).toBe(expected);
  });

  it('delegates to downloadLogsAsJsonl when format is json', () => {
    const tableData = [row('a'), row('b'), row('c')];
    const expected = 'json-result';
    mockDownloadLogsAsJsonl.mockReturnValue(expected);

    const result = downloadLogs({
      format: 'jsonl',
      tableData,
      fields,
      filename,
      limit: 2,
    });

    expect(mockDownloadLogsAsJsonl).toHaveBeenCalledTimes(1);
    expect(mockDownloadLogsAsJsonl).toHaveBeenCalledWith(tableData, filename);
    expect(mockDownloadLogsAsCsv).not.toHaveBeenCalled();
    expect(result).toBe(expected);
  });
});
