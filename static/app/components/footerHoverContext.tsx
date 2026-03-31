import {createContext, useContext, useEffect, useMemo, useReducer} from 'react';

type FooterHoverState = 'off' | 'active' | 'locked';

export const COOLING_PERIOD_MS = 400;

interface FooterHoverContextValue {
  hoverState: FooterHoverState;
  setButtonAreaHovered: (hovered: boolean) => void;
  setFooterHovered: (hovered: boolean) => void;
}

const FooterHoverContext = createContext<FooterHoverContextValue>({
  hoverState: 'off',
  setButtonAreaHovered: () => {},
  setFooterHovered: () => {},
});

export function useFooterHover(): FooterHoverContextValue {
  return useContext(FooterHoverContext);
}

type InternalState = 'off' | 'active' | 'locked' | 'cooling';

type HoverAction =
  | 'button-enter'
  | 'button-leave'
  | 'cooling-expired'
  | 'footer-enter'
  | 'footer-leave';

interface HoverInternalState {
  footerHovered: boolean;
  state: InternalState;
}

function hoverReducer(prev: HoverInternalState, action: HoverAction): HoverInternalState {
  switch (action) {
    case 'button-enter':
      return {
        ...prev,
        state:
          prev.state === 'active' || prev.state === 'cooling' ? 'locked' : prev.state,
      };

    case 'button-leave':
      return prev.state === 'locked'
        ? {...prev, state: prev.footerHovered ? 'active' : 'off'}
        : prev;

    case 'cooling-expired':
      return prev.state === 'cooling' ? {...prev, state: 'off'} : prev;

    case 'footer-enter':
      return {
        footerHovered: true,
        state: prev.state === 'off' || prev.state === 'cooling' ? 'active' : prev.state,
      };

    case 'footer-leave':
      return {
        footerHovered: false,
        state: prev.state === 'active' ? 'cooling' : prev.state,
      };
  }
}

export function FooterHoverProvider({children}: {children: React.ReactNode}) {
  const [internal, dispatch] = useReducer(hoverReducer, {
    footerHovered: false,
    state: 'off',
  });

  useEffect(() => {
    if (internal.state !== 'cooling') {
      return undefined;
    }
    const timer = setTimeout(() => dispatch('cooling-expired'), COOLING_PERIOD_MS);
    return () => clearTimeout(timer);
  }, [internal.state]);

  const value = useMemo(
    () => ({
      hoverState: internal.state === 'cooling' ? 'active' : internal.state,
      setFooterHovered: (hovered: boolean) =>
        dispatch(hovered ? 'footer-enter' : 'footer-leave'),
      setButtonAreaHovered: (hovered: boolean) =>
        dispatch(hovered ? 'button-enter' : 'button-leave'),
    }),
    [internal.state]
  );

  return (
    <FooterHoverContext.Provider value={value}>{children}</FooterHoverContext.Provider>
  );
}
