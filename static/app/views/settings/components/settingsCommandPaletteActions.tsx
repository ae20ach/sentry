import {cmdkQueryOptions} from 'sentry/components/commandPalette/types';
import type {
  CMDKQueryOptions,
  CommandPaletteAction,
} from 'sentry/components/commandPalette/types';
import {CMDKAction} from 'sentry/components/commandPalette/ui/cmdk';
import {CommandPaletteSlot} from 'sentry/components/commandPalette/ui/commandPaletteSlot';
import {getFormSourceResults} from 'sentry/components/search/sources/formSource';
import {IconSearch} from 'sentry/icons';
import {t} from 'sentry/locale';
import {replaceRouterParams} from 'sentry/utils/replaceRouterParams';
import {useParams} from 'sentry/utils/useParams';

function renderAsyncResult(item: CommandPaletteAction, index: number) {
  if ('to' in item) {
    return <CMDKAction key={index} {...item} />;
  }

  if ('onAction' in item) {
    return <CMDKAction key={index} {...item} />;
  }

  return null;
}

export async function getSettingsFormActions(
  query: string,
  params: {
    orgId?: string;
    projectId?: string;
    teamId?: string;
  }
): Promise<CommandPaletteAction[]> {
  const results = await getFormSourceResults(query);

  return results.flatMap(({item}) => {
    if (!item.to) {
      return [];
    }

    return [
      {
        display: {
          label: typeof item.title === 'string' ? item.title : '',
          details: typeof item.description === 'string' ? item.description : undefined,
        },
        to:
          typeof item.to === 'string'
            ? replaceRouterParams(item.to, params)
            : {
                ...item.to,
                pathname: replaceRouterParams(item.to.pathname, params),
              },
      },
    ];
  });
}

export function SettingsCommandPaletteActions() {
  const params = useParams<{
    orgId?: string;
    projectId?: string;
    teamId?: string;
  }>();

  return (
    <CommandPaletteSlot name="page">
      <CMDKAction
        display={{
          label: t('Settings Fields'),
          icon: <IconSearch />,
        }}
        prompt={t('Search settings...')}
        limit={10}
        resource={(query: string): CMDKQueryOptions =>
          cmdkQueryOptions({
            queryKey: ['command-palette-settings-form-search', query, params],
            enabled: query.trim().length > 0,
            queryFn: () => getSettingsFormActions(query, params),
            staleTime: 30_000,
          })
        }
      >
        {data => data.map((item, index) => renderAsyncResult(item, index))}
      </CMDKAction>
    </CommandPaletteSlot>
  );
}
