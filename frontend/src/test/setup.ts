import '@testing-library/jest-dom/vitest'

// Node >= 25 ships a built-in `localStorage` global that is *broken* unless the
// process was started with --localstorage-file; it shadows jsdom's working one
// and throws on .getItem. Replace any such broken global with a simple in-memory
// Storage so component tests run regardless of the host Node version.
function needsStoragePolyfill(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true
    localStorage.getItem('__probe__')
    return false
  } catch {
    return true
  }
}

if (needsStoragePolyfill()) {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  })
}
