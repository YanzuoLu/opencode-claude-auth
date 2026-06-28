import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  CCH_SEED,
  fallbackXXH64,
  patchCch,
  xxHash64,
} from "./cch.ts"

type BunHashGlobal = typeof globalThis & {
  Bun?: { hash?: { xxHash64?: (data: Uint8Array, seed: bigint) => bigint } }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bodyWithSystemText(text: string): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
      system: [{ type: "text", text }],
    }),
  )
}

describe("cch", () => {
  it("patchCch replaces placeholder with 5 hex chars", () => {
    const body = bodyWithSystemText(
      "x-anthropic-billing-header: cc_version=2.1.165.abc; cc_entrypoint=local-agent; cch=00000;",
    )

    assert.equal(patchCch(body), "patched")
    const decoded = decoder.decode(body)
    assert.doesNotMatch(decoded, /cch=00000/)
    assert.match(decoded, /cch=[0-9a-f]{5}/)
  })

  it("patchCch returns no-billing-header when marker is absent", () => {
    const body = bodyWithSystemText("user content with cch=00000 only")
    assert.equal(patchCch(body), "no-billing-header")
  })

  it("patchCch returns unanchored when placeholder is too far", () => {
    const body = bodyWithSystemText(
      `x-anthropic-billing-header: ${"a".repeat(151)}cch=00000;`,
    )
    assert.equal(patchCch(body), "unanchored")
  })

  it("fallbackXXH64 matches Bun-generated known-answer vectors", () => {
    const vectors: Array<[string, string]> = [
      ["", "b8b30e7de65b46c5"],
      ["abc", "dfc4f4d6913699b6"],
      ["0123456789abcdefghijklmnopqrstuvwxyzABCD", "1ec1a8b90524e0b7"],
      ["缓存-测试-🙂", "d7268f9d6defaf2f"],
    ]

    for (const [input, expected] of vectors) {
      assert.equal(
        fallbackXXH64(encoder.encode(input), CCH_SEED)
          .toString(16)
          .padStart(16, "0"),
        expected,
      )
    }
  })

  it("fallbackXXH64 cross-checks against Bun when available", () => {
    const bunXXH64 = (globalThis as BunHashGlobal).Bun?.hash?.xxHash64
    if (!bunXXH64) return

    for (const input of [
      "",
      "abc",
      "0123456789abcdefghijklmnopqrstuvwxyzABCD",
      "缓存-测试-🙂",
    ]) {
      const data = encoder.encode(input)
      assert.equal(fallbackXXH64(data, CCH_SEED), bunXXH64(data, CCH_SEED))
      assert.equal(xxHash64(data, CCH_SEED), bunXXH64(data, CCH_SEED))
    }
  })
})
