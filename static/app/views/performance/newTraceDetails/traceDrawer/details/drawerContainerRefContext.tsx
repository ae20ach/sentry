import {createContext, useContext} from 'react';

type DrawerContainerRef = React.RefObject<HTMLDivElement | null> | null;

export const DrawerContainerRefContext = createContext<DrawerContainerRef>(null);

export const useDrawerContainerRef = () => {
  const context = useContext(DrawerContainerRefContext);
  if (context === null) {
    throw new Error(
      'useDrawerContainerRef must be used within DrawerContainerRefContext.Provider'
    );
  }
  return context;
};
