import {useMemo} from 'react';
import {z} from 'zod';

import {Button} from '@sentry/scraps/button';
import {defaultFormOptions, useScrapsForm} from '@sentry/scraps/form';
import {Flex, Stack} from '@sentry/scraps/layout';
import {Heading, Text} from '@sentry/scraps/text';

import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import type {LogsQueryInfo} from 'sentry/components/dataExport';
import {ExportQueryType, useDataExport} from 'sentry/components/dataExport';
import {t} from 'sentry/locale';
import {TraceItemDataset} from 'sentry/views/explore/types';

const ROW_COUNT_VALUE_DEFAULT = 100;
const ROW_COUNT_VALUES = [ROW_COUNT_VALUE_DEFAULT, 500, 1_000, 5_000, 10_000] as const;

const exportModalFormSchema = z.object({
  allColumns: z.boolean(),
  format: z.enum(['csv', 'json']),
  rowCount: z.union(ROW_COUNT_VALUES.map(option => z.literal(option))),
});

type ExportModalFormValues = z.infer<typeof exportModalFormSchema>;

const defaultExportModalValues: ExportModalFormValues = {
  allColumns: false,
  format: 'csv',
  rowCount: 100,
};

type LogsExportModalProps = ModalRenderProps & {
  queryInfo: LogsQueryInfo;
};

export function LogsExportModal({
  Body,
  Footer,
  Header,
  closeModal,
  queryInfo,
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
  const {mutation} = useDataExport({payload});

  const form = useScrapsForm({
    ...defaultFormOptions,
    defaultValues: defaultExportModalValues,
    validators: {
      onDynamic: exportModalFormSchema,
    },
    onSubmit: async ({value}) => {
      try {
        const {data, statusCode} = await mutation.mutateAsync({limit: value.rowCount});
        // eslint-disable-next-line no-console -- TODO, Josh is testing :)
        console.log({data, statusCode});
      } finally {
        closeModal();
      }
    },
  });

  const rowOptions = ROW_COUNT_VALUES.map(value => ({label: value, value}));

  return (
    <form.AppForm form={form}>
      <Header closeButton>
        <Heading as="h2">{t('Export logs')}</Heading>
      </Header>
      <Body>
        <Stack gap="lg">
          <Text>{t("Hi! Let's export some logs!")}</Text>
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
                  <field.Radio.Item value="json">{t('JSON')}</field.Radio.Item>
                </field.Layout.Row>
              </field.Radio.Group>
            )}
          </form.AppField>
          <form.AppField name="rowCount">
            {field => (
              <field.Layout.Stack label={t('Number of rows')}>
                <field.Select
                  disabled={rowOptions.length === 1}
                  options={rowOptions}
                  onChange={field.handleChange}
                  value={field.state.value}
                  // @ts-expect-error -- TODO: scraps & union-of-literal selects?
                  defaultValue={rowOptions[0]!.value}
                />
              </field.Layout.Stack>
            )}
          </form.AppField>
          <form.AppField name="allColumns">
            {field => (
              <field.Layout.Row label={t('All Columns?')}>
                <field.Switch
                  checked={field.state.value ?? false}
                  onChange={field.handleChange}
                />
              </field.Layout.Row>
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
