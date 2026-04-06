import {useQuery} from '@tanstack/react-query';
import type {LocationDescriptor} from 'history';

import type {
  CMDKQueryOptions,
  CommandPaletteAsyncResult,
} from 'sentry/components/commandPalette/types';
import {CommandPaletteSlot} from 'sentry/components/commandPalette/ui/commandPaletteSlot';

import {makeCollection} from './collection';
import {
  CommandPaletteStateProvider,
  useCommandPaletteState,
} from './commandPaletteStateContext';

interface DisplayProps {
  label: string;
  details?: string;
  icon?: React.ReactNode;
}

interface CMDKActionDataBase {
  display: DisplayProps;
  keywords?: string[];
  ref?: React.RefObject<HTMLElement | null>;
}

interface CMDKActionDataTo extends CMDKActionDataBase {
  to: string;
}

interface CMDKActionDataOnAction extends CMDKActionDataBase {
  onAction: () => void;
}

interface CMDKActionDataResource extends CMDKActionDataBase {
  resource?: (query: string) => CMDKQueryOptions;
}

/**
 * Single data shape for all CMDK nodes. A node becomes a group by virtue of
 * having children registered under it — there is no separate group type.
 */
export type CMDKActionData =
  | CMDKActionDataTo
  | CMDKActionDataOnAction
  | CMDKActionDataResource;

export const CMDKCollection = makeCollection<CMDKActionData>();

/**
 * Root provider for the command palette. Wrap the component tree that
 * contains CMDKGroup/CMDKAction registrations and the CommandPalette UI.
 */
export function CommandPaletteProvider({children}: {children: React.ReactNode}) {
  return (
    <CommandPaletteStateProvider>
      <CommandPaletteSlot.Provider>
        <CMDKCollection.Provider>{children}</CMDKCollection.Provider>
      </CommandPaletteSlot.Provider>
    </CommandPaletteStateProvider>
  );
}

interface CMDKGroupProps {
  display: DisplayProps;
  children?: React.ReactNode | ((data: CommandPaletteAsyncResult[]) => React.ReactNode);
  keywords?: string[];
  resource?: (query: string) => CMDKQueryOptions;
}

type CMDKActionProps =
  | {display: DisplayProps; to: LocationDescriptor; keywords?: string[]}
  | {display: DisplayProps; onAction: () => void; keywords?: string[]};

/**
 * Registers a node in the collection and propagates its key to children via
 * GroupContext. When a `resource` prop is provided, fetches data using the
 * current query and passes results to a render-prop children function.
 */
export function CMDKGroup({display, keywords, resource, children}: CMDKGroupProps) {
  const ref = CommandPaletteSlot.useSlotOutletRef();
  const key = CMDKCollection.useRegisterNode({display, keywords, resource, ref});
  const {query} = useCommandPaletteState();

  const {data} = useQuery({
    ...(resource ? resource(query) : {queryKey: [], queryFn: () => null}),
    enabled: !!resource,
  });

  const resolvedChildren =
    typeof children === 'function' ? (data ? children(data) : null) : children;

  return (
    <CMDKCollection.Context.Provider value={key}>
      {resolvedChildren}
    </CMDKCollection.Context.Provider>
  );
}

/**
 * Registers a leaf action node in the collection.
 */
export function CMDKAction(props: CMDKActionProps) {
  const ref = CommandPaletteSlot.useSlotOutletRef();
  CMDKCollection.useRegisterNode({...props, ref});
  return null;
}
