import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

type StoredNode<T> = {
  dataRef: React.MutableRefObject<T>;
  key: string;
  parent: string | null;
};

export type CollectionTreeNode<T> = {
  children: Array<CollectionTreeNode<T>>;
  key: string;
  parent: string | null;
} & T;

export interface CollectionStore<T> {
  register: (node: StoredNode<T>) => void;
  tree: (rootKey?: string | null) => Array<CollectionTreeNode<T>>;
  unregister: (key: string) => void;
}

export interface CollectionInstance<T> {
  Context: React.Context<string | null>;
  Provider: (props: {children: React.ReactNode}) => React.ReactElement;
  useRegisterNode: (data: T) => string;
  useStore: () => CollectionStore<T>;
}

export function makeCollection<T>(): CollectionInstance<T> {
  const StoreContext = createContext<CollectionStore<T> | null>(null);

  const Context = createContext<string | null>(null);

  function Provider({children}: {children: React.ReactNode}) {
    const nodes = useRef(new Map<string, StoredNode<T>>());

    // Secondary index: parent key → ordered Set of child keys.
    // Insertion order = JSX order (guaranteed by React's depth-first left-to-right
    // effect ordering: siblings register before their next sibling's subtree fires).
    const childIndex = useRef(new Map<string | null, Set<string>>());

    // Increment version on every structural change (register/unregister).
    // React 18 automatic batching ensures that multiple dispatches from a
    // single commit's layout-effect phase are coalesced into one re-render,
    // so callers always see a complete (non-partial) tree.
    const [_, bump] = useReducer(x => (x + 1) % 2, 0);

    const store = useMemo<CollectionStore<T>>(
      () => ({
        register(node) {
          nodes.current.set(node.key, node);
          const siblings = childIndex.current.get(node.parent) ?? new Set<string>();
          siblings.add(node.key);
          childIndex.current.set(node.parent, siblings);
          bump();
        },

        unregister(key) {
          const node = nodes.current.get(key);
          if (!node) return;
          nodes.current.delete(key);
          childIndex.current.get(node.parent)?.delete(key);
          childIndex.current.delete(key);
          bump();
        },

        tree(rootKey = null): Array<CollectionTreeNode<T>> {
          const childKeys = childIndex.current.get(rootKey) ?? new Set<string>();
          return [...childKeys].map(key => {
            const node = nodes.current.get(key)!;
            return {
              key: node.key,
              parent: node.parent,
              children: this.tree(key),
              ...node.dataRef.current,
            };
          });
        },
      }),
      []
    );

    return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
  }

  function useStore(): CollectionStore<T> {
    const store = useContext(StoreContext);
    if (!store) {
      throw new Error('useStore must be called inside the matching Collection Provider');
    }
    return store;
  }

  function useRegisterNode(data: T): string {
    const store = useStore();
    const parentKey = useContext(Context);
    const key = useId();

    // Store data in a ref so tree() always reflects the latest value without
    // needing to re-register when data changes. Structural changes (parentKey)
    // still cause a full re-registration via the effect deps.
    const dataRef = useRef(data);
    dataRef.current = data;

    useLayoutEffect(() => {
      store.register({key, parent: parentKey, dataRef});
      return () => store.unregister(key);
    }, [key, parentKey, store]);

    return key;
  }

  return {Provider, Context, useStore, useRegisterNode};
}
