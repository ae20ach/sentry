import {createStorage} from 'sentry/utils/createStorage';

describe('createStorage', () => {
  it('returns noopStorage when underlying storage is null', () => {
    const storage = createStorage(() => null as unknown as Storage);

    expect(storage.getItem('any-key')).toBeNull();
    expect(() => storage.setItem('key', 'value')).not.toThrow();
    expect(() => storage.removeItem('key')).not.toThrow();
    expect(() => storage.clear()).not.toThrow();
    expect(storage).toHaveLength(0);
    expect(storage.key(0)).toBeNull();
  });

  it('returns noopStorage when storage.setItem throws', () => {
    const brokenStorage = {
      ...window.localStorage,
      setItem() {
        throw new DOMException('The quota has been exceeded.');
      },
    } as Storage;

    const storage = createStorage(() => brokenStorage);

    expect(storage.getItem('any-key')).toBeNull();
    expect(() => storage.setItem('key', 'value')).not.toThrow();
    expect(storage).toHaveLength(0);
  });

  it('returns real storage when it works correctly', () => {
    const storage = createStorage(() => window.localStorage);

    storage.setItem('test-key', 'test-value');
    expect(storage.getItem('test-key')).toBe('test-value');
    storage.removeItem('test-key');
    expect(storage.getItem('test-key')).toBeNull();
  });
});
