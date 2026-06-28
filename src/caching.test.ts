import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  applyCaching,
  countCacheControlBreakpoints,
  getCacheControl,
  normalizeCacheControlTtlOrdering,
  type CacheableRequestBody,
} from "./caching.ts"
import { SYSTEM_IDENTITY } from "./transforms.ts"

describe("caching", () => {
  it("applies 1h cache to CC system layout and recent messages", () => {
    const body: CacheableRequestBody = {
      system: [
        {
          type: "text",
          text: "x-anthropic-billing-header: cc_version=2.1.165.abc; cc_entrypoint=local-agent; cch=00000;",
        },
        { type: "text", text: SYSTEM_IDENTITY },
        { type: "text", text: "project instructions" },
      ],
      messages: [
        { role: "user", content: "older" },
        { role: "assistant", content: "middle" },
        { role: "user", content: "latest" },
      ],
    }

    applyCaching(body, getCacheControl(true))

    assert.deepEqual(body.system![2].cache_control, {
      type: "ephemeral",
      ttl: "1h",
    })
    assert.equal(typeof body.messages[2].content, "object")
    assert.deepEqual(
      (body.messages[2].content as Array<{ cache_control?: unknown }>)[0]
        .cache_control,
      { type: "ephemeral", ttl: "1h" },
    )
    assert.ok(countCacheControlBreakpoints(body) <= 4)
  })

  it("uses generic branch for a 2-entry system", () => {
    const body: CacheableRequestBody = {
      system: [
        {
          type: "text",
          text: "x-anthropic-billing-header: cc_version=2.1.165.abc; cc_entrypoint=local-agent; cch=00000;",
        },
        { type: "text", text: SYSTEM_IDENTITY },
      ],
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
    }

    applyCaching(body, getCacheControl(true))

    assert.deepEqual(body.system![1].cache_control, {
      type: "ephemeral",
      ttl: "1h",
    })
    assert.equal(typeof body.messages[0].content, "string")
    assert.equal(typeof body.messages[1].content, "object")
    assert.equal(typeof body.messages[2].content, "object")
    assert.ok(countCacheControlBreakpoints(body) <= 4)
  })

  it("upgrades upstream 5m breakpoints to 1h (OAuth) so retention actually applies", () => {
    // Mirrors what OpenCode / the AI SDK send: a 5m ephemeral on the last system
    // block and on the last user message. Without the align pass these would stay
    // 5m and the 1h patch would be a no-op.
    const body: CacheableRequestBody = {
      system: [
        {
          type: "text",
          text: "x-anthropic-billing-header: cc_version=2.1.165.abc; cc_entrypoint=local-agent; cch=00000;",
        },
        { type: "text", text: SYSTEM_IDENTITY },
        {
          type: "text",
          text: "project instructions",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: "older" },
        { role: "assistant", content: "middle" },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "latest",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    }

    applyCaching(body, getCacheControl(true))

    assert.deepEqual(body.system![2].cache_control, {
      type: "ephemeral",
      ttl: "1h",
    })
    assert.deepEqual(
      (body.messages[2].content as Array<{ cache_control?: unknown }>)[0]
        .cache_control,
      { type: "ephemeral", ttl: "1h" },
    )
    // No 5m (ttl-less) breakpoint should remain anywhere.
    const all = [
      ...(body.system ?? []),
      ...(body.tools ?? []),
      ...body.messages.flatMap((m) =>
        Array.isArray(m.content) ? m.content : [],
      ),
    ]
    for (const block of all) {
      if (block.cache_control) {
        assert.equal(
          (block.cache_control as { ttl?: string }).ttl,
          "1h",
          "every breakpoint should be 1h under OAuth",
        )
      }
    }
    assert.ok(countCacheControlBreakpoints(body) <= 4)
  })

  it("honors the 5m env override by not upgrading to 1h", () => {
    const prev = process.env.OPENCODE_CLAUDE_AUTH_CACHE_TTL
    process.env.OPENCODE_CLAUDE_AUTH_CACHE_TTL = "5m"
    try {
      const body: CacheableRequestBody = {
        system: [
          {
            type: "text",
            text: "x-anthropic-billing-header: cc_version=2.1.165.abc; cc_entrypoint=local-agent; cch=00000;",
          },
          { type: "text", text: SYSTEM_IDENTITY },
          {
            type: "text",
            text: "project instructions",
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
        messages: [{ role: "user", content: "latest" }],
      }
      applyCaching(body, getCacheControl(true))
      assert.deepEqual(body.system![2].cache_control, { type: "ephemeral" })
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_CLAUDE_AUTH_CACHE_TTL
      else process.env.OPENCODE_CLAUDE_AUTH_CACHE_TTL = prev
    }
  })

  it("normalizes later 1h cache controls after an earlier 5m block", () => {
    const body: CacheableRequestBody = {
      tools: [{ cache_control: { type: "ephemeral" } }],
      system: [
        {
          type: "text",
          text: "system",
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "hello",
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
        },
      ],
    }

    normalizeCacheControlTtlOrdering(body)

    assert.deepEqual(body.system![0].cache_control, { type: "ephemeral" })
    assert.deepEqual(
      (body.messages[0].content as Array<{ cache_control?: unknown }>)[0]
        .cache_control,
      { type: "ephemeral" },
    )
  })
})
