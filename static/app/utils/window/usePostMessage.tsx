import {createContext, useCallback, useContext, useEffect, useRef} from 'react';

type MessageCallback = (event: MessageEvent) => void;
type Unsubscribe = () => void;
type Subscribe = (callback: MessageCallback) => Unsubscribe;

const PostMessageContext = createContext<Subscribe | null>(null);

export function PostMessageProvider({children}: {children: React.ReactNode}) {
  const callbacksRef = useRef(new Set<MessageCallback>());

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      for (const callback of callbacksRef.current.values()) {
        callback(event);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const subscribe = useCallback((callback: MessageCallback) => {
    callbacksRef.current.add(callback);
    return () => callbacksRef.current.delete(callback);
  }, []);

  return (
    <PostMessageContext.Provider value={subscribe}>
      {children}
    </PostMessageContext.Provider>
  );
}

export function usePostMessageCallback() {
  const subscribe = useContext(PostMessageContext);
  if (!subscribe) {
    throw new Error('usePostMessageCallback must be used within a PostMessageProvider');
  }
  return subscribe;
}
