import {z} from 'zod';

import {Button} from '@sentry/scraps/button';
import {defaultFormOptions, useScrapsForm} from '@sentry/scraps/form';
import {Flex, Stack} from '@sentry/scraps/layout';
import {Heading, Text} from '@sentry/scraps/text';

import {addSuccessMessage} from 'sentry/actionCreators/indicator';
import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import {openModal} from 'sentry/actionCreators/modal';
import type {DataExportPayload} from 'sentry/components/dataExport';
import {useDataExport} from 'sentry/components/dataExport';
import {IconDownload} from 'sentry/icons';
import {t} from 'sentry/locale';

const ROW_COUNT_MAX = 1_000_000;

const exportModalFormSchema = z.object({
  format: z.enum(['csv', 'json']),
  rowCount: z.number().int().min(1).max(ROW_COUNT_MAX),
});

type ExportModalFormValues = z.infer<typeof exportModalFormSchema>;

const defaultExportModalValues: ExportModalFormValues = {
  format: 'csv',
  rowCount: 100,
};

type DataExportSessionExportConfig = {
  canExportInSession: boolean;
  onSessionExport: () => void;
};

function DataExportFormModal({
  Header,
  Body,
  Footer,
  closeModal,
  payload,
  sessionExport,
}: ModalRenderProps & {
  payload: DataExportPayload;
  sessionExport?: DataExportSessionExportConfig;
}) {
  const {runExport} = useDataExport({payload});

  const form = useScrapsForm({
    ...defaultFormOptions,
    defaultValues: defaultExportModalValues,
    validators: {
      onDynamic: exportModalFormSchema,
    },
    onSubmit: async ({value}) => {
      if (value.format !== 'csv') {
        return;
      }

      if (sessionExport?.canExportInSession) {
        sessionExport.onSessionExport();
        addSuccessMessage(
          t('Your export has started — the file should download momentarily.')
        );
        closeModal();
        return;
      }

      const ok = await runExport({limit: value.rowCount});
      if (ok) {
        closeModal();
      }
    },
  });

  return (
    <form.AppForm form={form}>
      <Header closeButton>
        <Heading as="h2">{t('Export data')}</Heading>
      </Header>
      <Body>
        <Stack gap="lg">
          <Text>{t('Hi Martha!')}</Text>
          <form.AppField name="format">
            {field => (
              <field.Radio.Group
                value={field.state.value}
                onChange={value =>
                  field.handleChange(value as ExportModalFormValues['format'])
                }
              >
                <field.Layout.Row label={t('Format')} required>
                  <field.Radio.Item value="csv">{t('CSV')}</field.Radio.Item>
                  <field.Radio.Item value="json" disabled>
                    {t('JSON')}
                  </field.Radio.Item>
                </field.Layout.Row>
              </field.Radio.Group>
            )}
          </form.AppField>
          <form.AppField name="rowCount">
            {field => (
              <field.Layout.Stack label={t('Number of rows')} required>
                <field.Number value={field.state.value} onChange={field.handleChange} />
              </field.Layout.Stack>
            )}
          </form.AppField>
        </Stack>
      </Body>
      <Footer>
        <Flex gap="xl" justify="end">
          <Button priority="default" onClick={closeModal}>
            {t('Cancel')}
          </Button>
          <form.SubmitButton priority="primary">{t('Export')}</form.SubmitButton>
        </Flex>
      </Footer>
    </form.AppForm>
  );
}

type DataExportWithModalProps = {
  payload: DataExportPayload;
  sessionExport: DataExportSessionExportConfig;
};

export function DataExportWithModal({payload, sessionExport}: DataExportWithModalProps) {
  const handleOpenModal = () => {
    openModal(deps => (
      <DataExportFormModal {...deps} payload={payload} sessionExport={sessionExport} />
    ));
  };

  return (
    <Button
      size="xs"
      priority="default"
      icon={<IconDownload />}
      onClick={handleOpenModal}
      tooltipProps={{
        title: t('Configure export options before starting your export.'),
      }}
    >
      {t('Export Data (Modal)')}
    </Button>
  );
}
