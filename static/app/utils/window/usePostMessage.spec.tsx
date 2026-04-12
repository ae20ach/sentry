import React from 'react';

import {act, render, renderHook} from 'sentry-test/reactTestingLibrary';

import {PostMessageProvider, usePostMessageCallback} from './usePostMessage';

function dispatchMessage(data: unknown, origin = document.location.origin) {
  const event = new MessageEvent('message', {data, origin});
  window.dispatchEvent(event);
}

describe('usePostMessage', () => {
  it('throws when used without PostMessageProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(usePostMessageCallback);
    }).toThrow('usePostMessageCallback must be used within a PostMessageProvider');
  });

  it('returns a subscribe function', () => {
    const {result} = renderHook(usePostMessageCallback, {
      wrapper: PostMessageProvider,
    });

    expect(typeof result.current).toBe('function');
  });

  it('receives window message events after subscribing', () => {
    const callback = jest.fn();

    const {result} = renderHook(usePostMessageCallback, {
      wrapper: PostMessageProvider,
    });

    act(() => {
      result.current(callback);
    });

    act(() => dispatchMessage({type: 'test'}));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({data: {type: 'test'}})
    );
  });

  it('dispatches to multiple subscribers', () => {
    const callbackA = jest.fn();
    const callbackB = jest.fn();

    const {result} = renderHook(usePostMessageCallback, {
      wrapper: PostMessageProvider,
    });

    act(() => {
      result.current(callbackA);
      result.current(callbackB);
    });

    act(() => dispatchMessage('hello'));

    expect(callbackA).toHaveBeenCalledTimes(1);
    expect(callbackB).toHaveBeenCalledTimes(1);
  });

  it('stops receiving messages after unsubscribing', () => {
    const callback = jest.fn();

    const {result} = renderHook(usePostMessageCallback, {
      wrapper: PostMessageProvider,
    });

    let unsubscribe: () => void;
    act(() => {
      unsubscribe = result.current(callback);
    });

    act(() => {
      unsubscribe();
    });

    act(() => dispatchMessage('after-unsubscribe'));

    expect(callback).not.toHaveBeenCalled();
  });

  it('stops receiving messages after unmount', () => {
    const callback = jest.fn();

    const {result, unmount} = renderHook(usePostMessageCallback, {
      wrapper: PostMessageProvider,
    });

    act(() => {
      result.current(callback);
    });

    unmount();

    act(() => dispatchMessage('after-unmount'));

    expect(callback).not.toHaveBeenCalled();
  });

  it('only unsubscribes the targeted callback, not siblings', () => {
    const stayingCallback = jest.fn();
    const leavingCallback = jest.fn();

    const {result} = renderHook(usePostMessageCallback, {
      wrapper: PostMessageProvider,
    });

    let unsubscribeLeaving: () => void;
    act(() => {
      result.current(stayingCallback);
      unsubscribeLeaving = result.current(leavingCallback);
    });

    act(() => dispatchMessage('both-present'));
    expect(stayingCallback).toHaveBeenCalledTimes(1);
    expect(leavingCallback).toHaveBeenCalledTimes(1);

    stayingCallback.mockClear();
    leavingCallback.mockClear();

    act(() => {
      unsubscribeLeaving();
    });

    act(() => dispatchMessage('one-removed'));
    expect(stayingCallback).toHaveBeenCalledTimes(1);
    expect(leavingCallback).not.toHaveBeenCalled();
  });

  it('only unregisters the unmounted hook, not siblings', () => {
    const stayingCallback = jest.fn();
    const leavingCallback = jest.fn();

    function StayingHook() {
      const subscribe = usePostMessageCallback();
      const callbackRef = React.useRef(stayingCallback);
      React.useEffect(() => subscribe(callbackRef.current), [subscribe]);
      return null;
    }

    function LeavingHook() {
      const subscribe = usePostMessageCallback();
      const callbackRef = React.useRef(leavingCallback);
      React.useEffect(() => subscribe(callbackRef.current), [subscribe]);
      return null;
    }

    function Both({showLeaving}: {showLeaving: boolean}) {
      return (
        <PostMessageProvider>
          <StayingHook />
          {showLeaving ? <LeavingHook /> : null}
        </PostMessageProvider>
      );
    }

    const {rerender} = render(<Both showLeaving />);

    act(() => dispatchMessage('both-present'));
    expect(stayingCallback).toHaveBeenCalledTimes(1);
    expect(leavingCallback).toHaveBeenCalledTimes(1);

    stayingCallback.mockClear();
    leavingCallback.mockClear();

    rerender(<Both showLeaving={false} />);

    act(() => dispatchMessage('one-removed'));
    expect(stayingCallback).toHaveBeenCalledTimes(1);
    expect(leavingCallback).not.toHaveBeenCalled();
  });

  it('passes the full MessageEvent to callbacks', () => {
    const callback = jest.fn();

    const {result} = renderHook(usePostMessageCallback, {
      wrapper: PostMessageProvider,
    });

    act(() => {
      result.current(callback);
    });

    act(() => dispatchMessage({key: 'value'}, 'https://example.com'));

    const event: MessageEvent = callback.mock.calls[0][0];
    expect(event).toBeInstanceOf(MessageEvent);
    expect(event.data).toEqual({key: 'value'});
    expect(event.origin).toBe('https://example.com');
  });
});

describe('PostMessageProvider', () => {
  it('cleans up the window listener when the provider unmounts', () => {
    const callback = jest.fn();

    const {result, unmount} = renderHook(usePostMessageCallback, {
      wrapper: PostMessageProvider,
    });

    act(() => {
      result.current(callback);
    });

    unmount();

    act(() => dispatchMessage('after-provider-unmount'));

    expect(callback).not.toHaveBeenCalled();
  });
});
