import {useMemo} from 'react';
import {z} from 'zod';

import {Button} from '@sentry/scraps/button';
import {defaultFormOptions, useScrapsForm} from '@sentry/scraps/form';
import {Flex, Stack} from '@sentry/scraps/layout';
import {Heading, Text} from '@sentry/scraps/text';

import {addSuccessMessage} from 'sentry/actionCreators/indicator';
import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import type {LogsQueryInfo} from 'sentry/components/dataExport';
import {ExportQueryType, useDataExport} from 'sentry/components/useDataExport';
import {t} from 'sentry/locale';
import {QUERY_PAGE_LIMIT} from 'sentry/views/explore/logs/constants';
import {downloadLogs} from 'sentry/views/explore/logs/downloadLogs';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';
import {TraceItemDataset} from 'sentry/views/explore/types';

const ROW_COUNT_VALUE_DEFAULT = 100;

/**
 * Keep this in sync with data_export.py on the backend
 * (TODO: Saraj is looking into updating this)
 */
const ROW_COUNT_VALUE_SYNC_LIMIT = QUERY_PAGE_LIMIT;

const ROW_COUNT_VALUES = [
  ROW_COUNT_VALUE_DEFAULT,
  500,
  ROW_COUNT_VALUE_SYNC_LIMIT,
  10_000,
  50_000,
  100_000,
];

const exportModalFormSchema = z.object({
  allColumns: z.boolean(),
  format: z.enum(['csv', 'json']),
  limit: z.number(),
});

type ExportModalFormValues = z.infer<typeof exportModalFormSchema>;

const defaultExportModalValues: ExportModalFormValues = {
  allColumns: false,
  format: 'csv',
  limit: 100,
};

type LogsExportModalProps = ModalRenderProps & {
  downloadLocally: boolean;
  queryInfo: LogsQueryInfo;
  tableData: OurLogsResponseItem[];
  threshold: number;
};

function generateRowOptions(dataLength: number) {
  let rowOptions = ROW_COUNT_VALUES.map(value => ({label: value, value}));

  // TODO: right now we only get up to the 1k page limit
  // Next up I'll try to pipe through the actual logs result number
  if (dataLength < ROW_COUNT_VALUE_SYNC_LIMIT) {
    rowOptions = rowOptions.filter(({value}) => value <= dataLength);
  }

  if (!rowOptions.length || dataLength > rowOptions[rowOptions.length - 1]!.value) {
    rowOptions.push({
      label: dataLength,
      value: dataLength,
    });
  }

  return rowOptions;
}

export function LogsExportModal({
  Body,
  Footer,
  Header,
  closeModal,
  queryInfo,
  tableData,
}: LogsExportModalProps) {
  const payload = useMemo(
    () => ({
      queryType: ExportQueryType.EXPLORE,
      queryInfo: {
        ...queryInfo,
        dataset: TraceItemDataset.LOGS,
      },
    }),
    [queryInfo]
  );
  const handleDataExport = useDataExport({payload});
  const rowOptions = generateRowOptions(tableData.length);

  const form = useScrapsForm({
    ...defaultFormOptions,
    defaultValues: defaultExportModalValues,
    validators: {
      onDynamic: exportModalFormSchema,
    },
    onSubmit: async ({value}) => {
      if (value.allColumns || value.limit > ROW_COUNT_VALUE_SYNC_LIMIT) {
        await handleDataExport(value.format);
        return;
      }

      downloadLogs({
        tableData,
        fields: queryInfo.field,
        filename: 'logs',
        format: value.format,
        limit: value.limit,
      });

      addSuccessMessage(t('Downloading file to your browser.'));
    },
  });

  return (
    <form.AppForm form={form}>
      <Header closeButton>
        <Heading as="h2">{t('Logs Export')}</Heading>
      </Header>
      <Body>
        <Stack gap="lg">
          <Text>
            {t(
              'If you select more than %s rows or to export all columns of data your file will be sent to your email address.',
              ROW_COUNT_VALUE_SYNC_LIMIT
            )}
          </Text>
          <form.AppField name="format">
            {field => (
              <field.Radio.Group
                value={field.state.value}
                onChange={value =>
                  field.handleChange(value as ExportModalFormValues['format'])
                }
              >
                <field.Layout.Stack label={t('Format')}>
                  <field.Radio.Item value="csv">{t('CSV')}</field.Radio.Item>
                  <field.Radio.Item value="json">{t('JSON')}</field.Radio.Item>
                </field.Layout.Stack>
              </field.Radio.Group>
            )}
          </form.AppField>
          <form.AppField name="limit">
            {field => (
              <field.Layout.Stack label={t('Number of rows')}>
                <field.Select
                  disabled={rowOptions.length === 1}
                  options={rowOptions}
                  onChange={field.handleChange}
                  value={field.state.value}
                  defaultValue={rowOptions[0]}
                />
              </field.Layout.Stack>
            )}
          </form.AppField>
          <form.AppField name="allColumns">
            {field => (
              <field.Layout.Stack label={t('All columns')}>
                <field.Switch
                  checked={field.state.value ?? false}
                  onChange={field.handleChange}
                />
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
