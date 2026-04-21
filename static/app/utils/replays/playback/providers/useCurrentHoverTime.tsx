import {createContext, useContext, useState} from 'react';

type ContextType = [
  undefined | number,
  React.Dispatch<React.SetStateAction<number | undefined>>,
];

const Context = createContext<ContextType>([undefined, () => {}]);

export function ReplayCurrentTimeContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = useState<undefined | number>(undefined);

  return <Context value={state}>{children}</Context>;
}

export function useCurrentHoverTime() {
  return useContext(Context);
}
