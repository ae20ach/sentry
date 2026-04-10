import {OrganizationFixture} from 'sentry-fixture/organization';

import {
  act,
  renderGlobalModal,
  render,
  screen,
  userEvent,
  within,
} from 'sentry-test/reactTestingLibrary';

import {addSuccessMessage} from 'sentry/actionCreators/indicator';
import {ExportQueryType} from 'sentry/components/dataExport';
import {DataExportWithModal} from 'sentry/components/dataExportWithModal';

jest.mock('sentry/actionCreators/indicator');

describe('DataExportWithModal', () => {
  const organization = OrganizationFixture({
    features: ['discover-query'],
  });

  const payload = {
    queryType: ExportQueryType.EXPLORE,
    queryInfo: {
      dataset: 'logs',
      field: ['timestamp'],
      project: [2],
      query: 'severity:error',
      sort: ['-timestamp'],
    },
  };

  beforeEach(() => {
    MockApiClient.clearMockResponses();
    jest.mocked(addSuccessMessage).mockClear();
  });

  it('opens modal and POSTs data export with limit when async export is required', async () => {
    const exportMock = MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/data-export/`,
      method: 'POST',
      body: {id: 721},
    });

    renderGlobalModal({organization});
    render(
      <DataExportWithModal
        payload={payload}
        overrideFeatureFlags
        sessionExport={{canExportInSession: false, onSessionExport: jest.fn()}}
      />,
      {
        organization,
      }
    );

    await userEvent.click(screen.getByRole('button', {name: 'Export Data (Modal)'}));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Hi Martha!')).toBeInTheDocument();

    const rowInput = within(dialog).getByRole('spinbutton', {name: 'Number of rows'});
    await userEvent.clear(rowInput);
    await userEvent.type(rowInput, '250');

    await userEvent.click(within(dialog).getByRole('button', {name: 'Export'}));

    await act(async () => {
      await Promise.resolve();
    });

    expect(exportMock).toHaveBeenCalledWith(
      `/organizations/${organization.slug}/data-export/`,
      expect.objectContaining({
        method: 'POST',
        data: expect.objectContaining({
          query_type: ExportQueryType.EXPLORE,
          query_info: payload.queryInfo,
          limit: 250,
        }),
      })
    );
    expect(jest.mocked(addSuccessMessage)).not.toHaveBeenCalledWith(
      expect.stringContaining('download momentarily')
    );
  });

  it('runs in-session export and shows success when canExportInSession', async () => {
    const onSessionExport = jest.fn();
    const exportMock = MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/data-export/`,
      method: 'POST',
      body: {id: 721},
    });

    renderGlobalModal({organization});
    render(
      <DataExportWithModal
        payload={payload}
        overrideFeatureFlags
        sessionExport={{canExportInSession: true, onSessionExport}}
      />,
      {
        organization,
      }
    );

    await userEvent.click(screen.getByRole('button', {name: 'Export Data (Modal)'}));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', {name: 'Export'}));

    await act(async () => {
      await Promise.resolve();
    });

    expect(onSessionExport).toHaveBeenCalled();
    expect(exportMock).not.toHaveBeenCalled();
    expect(addSuccessMessage).toHaveBeenCalledWith(
      'Your export has started — the file should download momentarily.'
    );
  });

  it('does not render trigger when organization lacks discover-query and no override', () => {
    const orgWithoutDiscover = OrganizationFixture({features: []});

    renderGlobalModal({organization: orgWithoutDiscover});
    render(<DataExportWithModal payload={payload} />, {
      organization: orgWithoutDiscover,
    });

    expect(
      screen.queryByRole('button', {name: 'Export Data (Modal)'})
    ).not.toBeInTheDocument();
  });
});
