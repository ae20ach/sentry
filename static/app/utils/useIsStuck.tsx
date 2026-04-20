import {useEffect, useState} from 'react';

interface Options {
  position?: 'top' | 'bottom';
}

function getStickyOffset(el: HTMLElement, position: 'top' | 'bottom') {
  const stickyOffset = window.getComputedStyle(el)[position];
  const offset = Number.parseFloat(stickyOffset);
  return Number.isFinite(offset) ? offset : 0;
}

function getObserverRootMargin(position: 'top' | 'bottom', offset: number) {
  return position === 'top'
    ? `-${offset + 1}px 0px 0px 0px`
    : `0px 0px -${offset + 1}px 0px`;
}

/**
 * Determine if a element with `position: sticky` is currently stuck.
 */
export function useIsStuck(el: HTMLElement | null, options: Options = {}) {
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    if (el === null) {
      setIsStuck(false);
      return () => {};
    }

    const position = options.position ?? 'top';
    let observer: IntersectionObserver | null = null;

    const observe = () => {
      observer?.disconnect();

      observer = new IntersectionObserver(
        ([entry]) => setIsStuck(entry!.intersectionRatio < 1),
        {
          rootMargin: getObserverRootMargin(position, getStickyOffset(el, position)),
          threshold: [1],
        }
      );

      observer.observe(el);
    };

    observe();

    const handleResize = () => observe();
    const styleObserver = new MutationObserver(() => observe());

    window.addEventListener('resize', handleResize);
    styleObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    styleObserver.observe(el, {
      attributes: true,
      attributeFilter: ['style'],
    });

    return () => {
      observer?.disconnect();
      styleObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [el, options.position]);

  return isStuck;
}
