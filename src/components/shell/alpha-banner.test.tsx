import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToString } from "react-dom/server"

// Node test env: stub just enough of `window` for the storage helpers.
function stubWindow(storage: Partial<Storage>) {
  vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn(), removeEventListener: vi.fn() })
}

async function load() {
  vi.resetModules()
  return import("./alpha-banner")
}

afterEach(() => vi.unstubAllGlobals())

describe("AlphaBanner", () => {
  it("renders nothing on the server, even for a new visitor (so hydration matches)", async () => {
    stubWindow({ getItem: () => null })
    const { AlphaBanner } = await load()
    expect(renderToString(<AlphaBanner />)).toBe("")
  })

  it("is shown for a new visitor and hidden once dismissed", async () => {
    const store = new Map<string, string>()
    stubWindow({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) })
    const { isDismissed, dismissBanner, STORAGE_KEY } = await load()
    expect(STORAGE_KEY).toBe("alpha-banner-dismissed")
    expect(isDismissed()).toBe(false)
    dismissBanner()
    expect(store.get(STORAGE_KEY)).toBe("1")
    expect(isDismissed()).toBe(true)
  })

  it("does not throw when storage is unavailable, and still dismisses for the page session", async () => {
    stubWindow({
      getItem: () => { throw new Error("SecurityError") },
      setItem: () => { throw new Error("QuotaExceededError") },
    })
    const { isDismissed, dismissBanner } = await load()
    expect(isDismissed()).toBe(false)
    expect(() => dismissBanner()).not.toThrow()
    expect(isDismissed()).toBe(true)
  })
})
