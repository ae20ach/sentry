import type {ReactNode} from 'react';
import {z} from 'zod';

import {Button} from '@sentry/scraps/button';
import {defaultFormOptions, useScrapsForm} from '@sentry/scraps/form';
import {Flex, Stack} from '@sentry/scraps/layout';
import {Heading, Text} from '@sentry/scraps/text';

import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import {openModal} from 'sentry/actionCreators/modal';
import Feature from 'sentry/components/acl/feature';
import type {DataExportPayload} from 'sentry/components/dataExport';
import {useDataExport} from 'sentry/components/dataExport';
import {t} from 'sentry/locale';

const ROW_COUNT_MAX = 1_000_000;

const exportModalFormSchema = z.object({
  rowCount: z.number().int().min(1).max(ROW_COUNT_MAX),
});

type ExportModalFormValues = z.infer<typeof exportModalFormSchema>;

function DataExportFormModal({
  Header,
  Body,
  Footer,
  closeModal,
  payload,
}: ModalRenderProps & {payload: DataExportPayload}) {
  const runExport = useDataExport({payload});

  const form = useScrapsForm({
    ...defaultFormOptions,
    defaultValues: {
      rowCount: 100,
    } satisfies ExportModalFormValues,
    validators: {
      onDynamic: exportModalFormSchema,
    },
    onSubmit: async ({value}) => {
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
        <Flex gap="xl" justify="flex-end">
          <Button priority="default" onClick={closeModal}>
            {t('Cancel')}
          </Button>
          <form.SubmitButton priority="primary">{t('Export')}</form.SubmitButton>
        </Flex>
      </Footer>
    </form.AppForm>
  );
}

export type DataExportWithModalProps = {
  payload: DataExportPayload;
  disabled?: boolean;
  disabledTooltip?: string;
  icon?: ReactNode;
  overrideFeatureFlags?: boolean;
  size?: 'xs' | 'sm' | 'md';
};

export function DataExportWithModal({
  disabled,
  disabledTooltip,
  icon,
  overrideFeatureFlags,
  payload,
  size = 'sm',
}: DataExportWithModalProps) {
  const handleOpenModal = () => {
    openModal(deps => <DataExportFormModal {...deps} payload={payload} />);
  };

  return (
    <Feature features={overrideFeatureFlags ? [] : 'organizations:discover-query'}>
      <Button
        size={size}
        priority="default"
        disabled={disabled}
        icon={icon}
        onClick={handleOpenModal}
        tooltipProps={{
          title: disabled
            ? disabledTooltip
            : t('Configure export options before starting your export.'),
        }}
      >
        {t('Export Data (Modal)')}
      </Button>
    </Feature>
  );
}
