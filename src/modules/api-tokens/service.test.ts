import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db"
import { createApiToken, verifyApiToken, verifyBearerHeader } from "./service"

const mockCreate = vi.mocked(prisma.apiToken.create)
const mockFindUnique = vi.mocked(prisma.apiToken.findUnique)
const mockUpdate = vi.mocked(prisma.apiToken.update)

const RAW = "rsm_" + "a".repeat(43)

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "tok-1",
    profileId: "profile-1",
    revokedAt: null,
    scopes: ["capture"],
    expiresAt: null,
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({} as never)
})

describe("verifyApiToken", () => {
  it("returns profileId, tokenId and scopes for a valid token", async () => {
    mockFindUnique.mockResolvedValue(record({ scopes: ["capture", "mcp:read"] }))
    expect(await verifyApiToken(RAW)).toEqual({
      profileId: "profile-1",
      tokenId: "tok-1",
      scopes: ["capture", "mcp:read"],
    })
  })

  it("returns null when expiresAt is in the past", async () => {
    mockFindUnique.mockResolvedValue(record({ expiresAt: new Date(Date.now() - 1000) }))
    expect(await verifyApiToken(RAW)).toBeNull()
  })

  it("accepts a future expiresAt", async () => {
    mockFindUnique.mockResolvedValue(record({ expiresAt: new Date(Date.now() + 60_000) }))
    expect(await verifyApiToken(RAW)).not.toBeNull()
  })

  it("accepts a null expiresAt", async () => {
    mockFindUnique.mockResolvedValue(record({ expiresAt: null }))
    expect(await verifyApiToken(RAW)).not.toBeNull()
  })

  it("returns null for a revoked token", async () => {
    mockFindUnique.mockResolvedValue(record({ revokedAt: new Date() }))
    expect(await verifyApiToken(RAW)).toBeNull()
  })
})

describe("verifyBearerHeader", () => {
  it("returns null for an expired token", async () => {
    mockFindUnique.mockResolvedValue(record({ expiresAt: new Date(Date.now() - 1000) }))
    expect(await verifyBearerHeader(`Bearer ${RAW}`)).toBeNull()
  })

  it("returns the verified token for a valid header", async () => {
    mockFindUnique.mockResolvedValue(record())
    expect(await verifyBearerHeader(`Bearer ${RAW}`)).toEqual({
      profileId: "profile-1",
      tokenId: "tok-1",
      scopes: ["capture"],
    })
  })
})

describe("createApiToken", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue({ id: "tok-1", prefix: "rsm_aaaaaaaa", name: "n" } as never)
  })

  it("defaults scopes to ['capture'] and no expiry", async () => {
    await createApiToken("profile-1", "n")
    const arg = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(arg.data.scopes).toEqual(["capture"])
    expect(arg.data.expiresAt ?? null).toBeNull()
  })

  it("passes through given scopes and expiresAt", async () => {
    const expiresAt = new Date("2030-01-01T00:00:00Z")
    await createApiToken("profile-1", "n", { scopes: ["mcp:read", "mcp:write"], expiresAt })
    const arg = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(arg.data.scopes).toEqual(["mcp:read", "mcp:write"])
    expect(arg.data.expiresAt).toBe(expiresAt)
  })
})
