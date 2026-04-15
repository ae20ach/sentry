import {LogFixture} from 'sentry-fixture/log';
import {OrganizationFixture} from 'sentry-fixture/organization';

import {render, screen, userEvent, waitFor} from 'sentry-test/reactTestingLibrary';

import {addSuccessMessage} from 'sentry/actionCreators/indicator';
import type {LogsQueryInfo} from 'sentry/components/exports/dataExport';
import {
  makeCloseButton,
  makeClosableHeader,
  ModalBody,
  ModalFooter,
} from 'sentry/components/globalModal/components';
import {QUERY_PAGE_LIMIT} from 'sentry/views/explore/logs/constants';
import {LogsExportModal} from 'sentry/views/explore/logs/logsExportModal';
import {OurLogKnownFieldKey} from 'sentry/views/explore/logs/types';

const mockAddSuccessMessage = jest.fn();

jest.mock('sentry/actionCreators/indicator', () => ({
  get addSuccessMessage() {
    return mockAddSuccessMessage;
  },
}));

const mockDownloadLogs = jest.fn();

jest.mock('sentry/views/explore/logs/downloadLogs', () => ({
  get downloadLogs() {
    return mockDownloadLogs;
  },
}));

const mockUseDataExport = jest.fn();

jest.mock('sentry/components/exports/useDataExport', () => ({
  ...jest.requireActual('sentry/components/exports/useDataExport'),
  get useDataExport() {
    return mockUseDataExport;
  },
}));

const organization = OrganizationFixture({features: ['discover-query']});
const closeModal = jest.fn();
const mockHandleDataExport = jest.fn();

const queryInfo: LogsQueryInfo = {
  dataset: 'logs',
  field: [OurLogKnownFieldKey.MESSAGE],
  project: [1],
  query: 'level:error',
  sort: ['-timestamp'],
};

const tableData = new Array(500).map((_, i) =>
  LogFixture({
    id: `log-${i}`,
    [OurLogKnownFieldKey.PROJECT_ID]: `${i}`,
    [OurLogKnownFieldKey.ORGANIZATION_ID]: Number(organization.id),
  })
);

function renderModal(estimatedRowCount: number) {
  mockUseDataExport.mockReturnValue(mockHandleDataExport);

  return render(
    <LogsExportModal
      Body={ModalBody}
      Footer={ModalFooter}
      Header={makeClosableHeader(closeModal)}
      CloseButton={makeCloseButton(closeModal)}
      closeModal={closeModal}
      estimatedRowCount={estimatedRowCount}
      queryInfo={queryInfo}
      tableData={tableData}
    />,
    {organization}
  );
}

describe('LogsExportModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls closeModal when Cancel is clicked', async () => {
    renderModal(500);

    await userEvent.click(screen.getByRole('button', {name: 'Cancel'}));

    expect(closeModal).toHaveBeenCalled();
  });

  it('downloads in the browser and shows a success toast when Export is clicked without any options', async () => {
    renderModal(500);

    await userEvent.click(screen.getByRole('button', {name: 'Export'}));

    await waitFor(() => {
      expect(mockDownloadLogs).toHaveBeenCalledTimes(1);
    });

    expect(mockDownloadLogs).toHaveBeenCalledWith({
      rows: tableData.slice(0, 100),
      fields: queryInfo.field,
      filename: 'logs',
      format: 'csv',
    });
    expect(mockHandleDataExport).not.toHaveBeenCalled();
    expect(addSuccessMessage).toHaveBeenCalledWith('Downloading file to your browser.');
  });

  it('calls handleDataExport when Export is clicked with all columns enabled', async () => {
    renderModal(500);

    await userEvent.click(screen.getByRole('checkbox', {name: /all columns/i}));
    await userEvent.click(screen.getByRole('button', {name: 'Export'}));

    await waitFor(() => {
      expect(mockHandleDataExport).toHaveBeenCalledWith('csv');
    });

    expect(mockDownloadLogs).not.toHaveBeenCalled();
    expect(mockAddSuccessMessage).not.toHaveBeenCalled();
  });

  it('calls handleDataExport when row limit is above the sync limit', async () => {
    const aboveSyncLimit = QUERY_PAGE_LIMIT + 1;
    renderModal(aboveSyncLimit);

    await userEvent.click(screen.getByRole('textbox'));
    await userEvent.click(
      screen.getByRole('menuitemradio', {name: String(aboveSyncLimit)})
    );
    await userEvent.click(screen.getByRole('button', {name: 'Export'}));

    await waitFor(() => {
      expect(mockHandleDataExport).toHaveBeenCalledWith('csv');
    });

    expect(mockDownloadLogs).not.toHaveBeenCalled();
    expect(mockAddSuccessMessage).not.toHaveBeenCalled();
  });
});
