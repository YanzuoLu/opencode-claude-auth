import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ensureTrailingUser,
  repairToolPairs,
  stripToolPrefix,
  transformBody,
  transformResponseStream,
} from "./transforms.ts"
import { sessionId } from "./session.ts"

const omittedResult = (toolUseId: string) => ({
  type: "tool_result",
  tool_use_id: toolUseId,
  content: "[Tool result omitted during context management]",
  is_error: true,
})

describe("transforms", () => {
  it("transformBody relocates third-party system prompt by default", () => {
    const input = JSON.stringify({
      system: [
        {
          type: "text",
          text: "OpenCode and opencode",
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [{ name: "search" }],
      messages: [{ role: "user", content: "hello" }],
    })

    const output = transformBody(input)
    assert.equal(typeof output, "string")
    const parsed = JSON.parse(output as string) as {
      system: Array<{ text: string; cache_control?: unknown }>
      tools: Array<{ name: string }>
      messages: Array<{ content: Array<{ text: string }> }>
    }

    assert.equal(parsed.system.length, 2)
    assert.ok(parsed.system[0].text.startsWith("x-anthropic-billing-header:"))
    assert.equal(
      parsed.system[1].text,
      "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
    )
    assert.equal(parsed.tools[0].name, "mcp_Search")
    assert.ok(parsed.messages[0].content[0].text.includes("OpenCode"))
    assert.ok(parsed.messages[0].content[0].text.includes("hello"))
  })

  it("transformBody keeps third-party system prompt when keep-system env is set", () => {
    process.env.OPENCODE_CLAUDE_AUTH_KEEP_SYSTEM = "1"
    try {
      const input = JSON.stringify({
        system: [{ type: "text", text: "Custom instructions" }],
        messages: [{ role: "user", content: "hello" }],
      })

      const output = transformBody(input)
      const parsed = JSON.parse(output as string) as {
        system: Array<{ text: string }>
        messages: Array<{ content: Array<{ text: string }> }>
      }

      assert.equal(parsed.system.length, 3)
      assert.ok(parsed.system[0].text.startsWith("x-anthropic-billing-header:"))
      assert.equal(
        parsed.system[1].text,
        "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
      )
      assert.equal(parsed.system[2].text, "Custom instructions")
      assert.equal(parsed.messages[0].content[0].text, "hello")
    } finally {
      delete process.env.OPENCODE_CLAUDE_AUTH_KEEP_SYSTEM
    }
  })

  it("transformBody can disable default relocation with legacy env value 0", () => {
    process.env.OPENCODE_CLAUDE_AUTH_RELOCATE_SYSTEM = "0"
    try {
      const input = JSON.stringify({
        system: [{ type: "text", text: "Custom instructions" }],
        messages: [{ role: "user", content: "hello" }],
      })

      const output = transformBody(input)
      const parsed = JSON.parse(output as string) as {
        system: Array<{ text: string }>
      }

      assert.equal(parsed.system.length, 3)
      assert.equal(parsed.system[2].text, "Custom instructions")
    } finally {
      delete process.env.OPENCODE_CLAUDE_AUTH_RELOCATE_SYSTEM
    }
  })

  it("transformBody injects billing header as system[0] with literal cch placeholder", () => {
    const input = JSON.stringify({
      messages: [{ role: "user", content: "hey" }],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      system: Array<{ type: string; text: string; cache_control?: unknown }>
    }

    assert.deepEqual(Object.keys(parsed.system[0]), ["type", "text"])
    assert.ok(parsed.system[0].text.startsWith("x-anthropic-billing-header:"))
    assert.ok(parsed.system[0].text.includes("cc_entrypoint=local-agent"))
    assert.ok(parsed.system[0].text.includes("cch=00000"))
    assert.equal(parsed.system[0].cache_control, undefined)
  })

  it("transformBody clamps OAuth max_tokens to 64000 without raising", () => {
    const high = JSON.parse(
      transformBody(
        JSON.stringify({
          max_tokens: 128000,
          messages: [{ role: "user", content: "hello" }],
        }),
      ) as string,
    ) as { max_tokens: number }
    const low = JSON.parse(
      transformBody(
        JSON.stringify({
          max_tokens: 1024,
          messages: [{ role: "user", content: "hello" }],
        }),
      ) as string,
    ) as { max_tokens: number }

    assert.equal(high.max_tokens, 64000)
    assert.equal(low.max_tokens, 1024)
  })

  it("transformBody injects stable metadata.user_id session_id", () => {
    const makeBody = () =>
      JSON.parse(
        transformBody(
          JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
        ) as string,
      ) as { metadata: { user_id: string } }

    const first = JSON.parse(makeBody().metadata.user_id) as {
      session_id?: string
    }
    const second = JSON.parse(makeBody().metadata.user_id) as {
      session_id?: string
    }

    assert.match(
      first.session_id ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    assert.equal(first.session_id, second.session_id)
    assert.equal(first.session_id, sessionId)
  })

  it("transformBody normalizes existing metadata.user_id to the shared session id", () => {
    const parsed = JSON.parse(
      transformBody(
        JSON.stringify({
          metadata: {
            user_id: JSON.stringify({ session_id: "old", extra: true }),
          },
          messages: [{ role: "user", content: "hello" }],
        }),
      ) as string,
    ) as { metadata: { user_id: string } }

    const userId = JSON.parse(parsed.metadata.user_id) as {
      session_id?: string
      extra?: boolean
    }
    assert.equal(userId.session_id, sessionId)
    assert.equal(userId.extra, true)
  })

  it("transformBody keeps system intact when no messages exist", () => {
    const input = JSON.stringify({
      system: [{ type: "text", text: "Some instructions" }],
      messages: [],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      system: Array<{ text: string }>
    }

    assert.equal(parsed.system[2].text, "Some instructions")
  })

  it("transformBody strips output_config.effort for haiku", () => {
    const input = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      output_config: { effort: "high" },
      messages: [{ role: "user", content: "test" }],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      output_config?: Record<string, unknown>
    }

    assert.equal(
      parsed.output_config,
      undefined,
      "output_config should be removed when effort was its only field",
    )
  })

  it("transformBody strips effort but keeps other output_config fields for haiku", () => {
    const input = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      output_config: { effort: "high", max_tokens: 1024 },
      messages: [{ role: "user", content: "test" }],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      output_config?: { effort?: string; max_tokens?: number }
    }

    assert.ok(
      parsed.output_config,
      "output_config should be preserved when other fields exist",
    )
    assert.equal(parsed.output_config!.max_tokens, 1024)
    assert.equal(
      parsed.output_config!.effort,
      undefined,
      "effort should be stripped",
    )
  })

  it("transformBody strips thinking.effort but preserves other fields for haiku", () => {
    const input = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      thinking: { type: "enabled", effort: "high" },
      messages: [{ role: "user", content: "test" }],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      thinking?: Record<string, unknown>
    }

    assert.ok(
      parsed.thinking,
      "thinking should be preserved when non-effort fields remain",
    )
    assert.equal(
      parsed.thinking!.effort,
      undefined,
      "effort should be stripped",
    )
    assert.equal(parsed.thinking!.type, "enabled", "type should be preserved")
  })

  it("transformBody removes thinking entirely when effort is its only field for haiku", () => {
    const input = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      thinking: { effort: "high" },
      messages: [{ role: "user", content: "test" }],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      thinking?: Record<string, unknown>
    }

    assert.equal(
      parsed.thinking,
      undefined,
      "thinking should be removed when effort was its only field",
    )
  })

  it("transformBody preserves thinking for haiku when effort is absent", () => {
    const input = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      thinking: { type: "enabled" },
      messages: [{ role: "user", content: "test" }],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      thinking?: Record<string, unknown>
    }

    assert.deepEqual(
      parsed.thinking,
      { type: "enabled" },
      "thinking without effort should pass through unchanged",
    )
  })

  it("transformBody preserves effort for non-haiku models", () => {
    const input = JSON.stringify({
      model: "claude-opus-4-6",
      output_config: { effort: "high" },
      thinking: { type: "enabled", effort: "high" },
      messages: [{ role: "user", content: "test" }],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      output_config?: { effort?: string }
      thinking?: { effort?: string }
    }

    assert.equal(
      parsed.output_config!.effort,
      "high",
      "output_config.effort should remain for opus",
    )
    assert.equal(
      parsed.thinking!.effort,
      "high",
      "thinking.effort should remain for opus",
    )
  })

  it("transformBody handles haiku without effort-related fields", () => {
    const input = JSON.stringify({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "test" }],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      output_config?: unknown
      thinking?: unknown
    }

    assert.equal(parsed.output_config, undefined)
    assert.equal(parsed.thinking, undefined)
  })

  it("transformBody strips OMP-style 1M model suffixes before the API request", () => {
    const bracket = JSON.parse(
      transformBody(
        JSON.stringify({
          model: "claude-sonnet-4-6[1m]",
          messages: [{ role: "user", content: "test" }],
        }),
      ) as string,
    ) as { model?: string }

    const alias = JSON.parse(
      transformBody(
        JSON.stringify({
          model: "claude-opus-4-6-1m",
          messages: [{ role: "user", content: "test" }],
        }),
      ) as string,
    ) as { model?: string }

    assert.equal(bracket.model, "claude-sonnet-4-6")
    assert.equal(alias.model, "claude-opus-4-6")
  })

  it("transformBody PascalCase-prefixes tool names with mcp_", () => {
    const input = JSON.stringify({
      system: [],
      tools: [
        { name: "bash" },
        { name: "read" },
        { name: "background_output" },
      ],
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_1", name: "bash" },
            {
              type: "tool_use",
              id: "toolu_2",
              name: "background_output",
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
            { type: "tool_result", tool_use_id: "toolu_2", content: "ok" },
          ],
        },
      ],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      tools: Array<{ name: string }>
      messages: Array<{
        content: Array<{ type: string; name?: string }>
      }>
    }

    assert.equal(parsed.tools[0].name, "mcp_Bash")
    assert.equal(parsed.tools[1].name, "mcp_Read")
    assert.equal(parsed.tools[2].name, "mcp_Background_output")
    assert.equal(parsed.messages[0].content[0].name, "mcp_Bash")
    assert.equal(parsed.messages[0].content[1].name, "mcp_Background_output")
  })

  it("stripToolPrefix reverses PascalCase mcp_ prefix", () => {
    assert.equal(stripToolPrefix('{"name": "mcp_Bash"}'), '{"name": "bash"}')
    assert.equal(
      stripToolPrefix('{"name": "mcp_Background_output"}'),
      '{"name": "background_output"}',
    )
  })

  it("stripToolPrefix removes mcp_ from response payload names", () => {
    const input = '{"name":"mcp_search","type":"tool_use"}'
    assert.equal(stripToolPrefix(input), '{"name": "search","type":"tool_use"}')
  })

  it("transformResponseStream passes error responses through without SSE parsing", async () => {
    const errorBody = JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Test error message",
      },
    })
    const response = new Response(errorBody, {
      status: 400,
      statusText: "Bad Request",
      headers: { "content-type": "application/json" },
    })

    const transformed = transformResponseStream(response)
    assert.equal(transformed.status, 400)
    assert.equal(transformed.statusText, "Bad Request")

    const text = await transformed.text()
    assert.equal(text, errorBody, "Error body should pass through unchanged")
  })

  it("transformResponseStream passes 401 errors through intact", async () => {
    const errorBody = JSON.stringify({
      type: "error",
      error: {
        type: "authentication_error",
        message: "OAuth token has expired.",
      },
    })
    const response = new Response(errorBody, { status: 401 })
    const transformed = transformResponseStream(response)
    assert.equal(transformed.status, 401)
    const text = await transformed.text()
    const parsed = JSON.parse(text) as { error: { message: string } }
    assert.equal(parsed.error.message, "OAuth token has expired.")
  })

  it("transformResponseStream passes 429 errors through intact", async () => {
    const errorBody = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limited" },
    })
    const response = new Response(errorBody, {
      status: 429,
      headers: { "retry-after": "30" },
    })
    const transformed = transformResponseStream(response)
    assert.equal(transformed.status, 429)
    assert.equal(transformed.headers.get("retry-after"), "30")
    const text = await transformed.text()
    assert.ok(text.includes("Rate limited"))
  })

  it("transformResponseStream passes 529 overloaded errors through", async () => {
    const response = new Response("Overloaded", { status: 529 })
    const transformed = transformResponseStream(response)
    assert.equal(transformed.status, 529)
    const text = await transformed.text()
    assert.equal(text, "Overloaded")
  })

  it("transformResponseStream still strips tool prefixes in error bodies", async () => {
    // stripToolPrefix matches the pattern "name": "mcp_..."
    const errorBody = '{"name": "mcp_search", "error": "failed"}'
    const response = new Response(errorBody, { status: 400 })
    const transformed = transformResponseStream(response)
    const text = await transformed.text()
    assert.ok(
      text.includes('"name": "search"'),
      "Should strip mcp_ prefix even in error bodies",
    )
    assert.ok(
      !text.includes("mcp_search"),
      "Should not contain mcp_search after stripping",
    )
  })

  it("transformResponseStream rewrites streamed tool names", async () => {
    const payload = '{"name":"mcp_lookup"}'
    const response = new Response(payload)
    const transformed = transformResponseStream(response)
    const text = await transformed.text()

    assert.equal(text, '{"name": "lookup"}')
  })

  it("transformResponseStream buffers across chunks until event boundary", async () => {
    const chunk1 = 'data: {"name":"mc'
    const chunk2 = 'p_search"}\n\ndata: {"type":"done"}\n\n'
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1))
        controller.enqueue(encoder.encode(chunk2))
        controller.close()
      },
    })

    const response = new Response(stream)
    const transformed = transformResponseStream(response)
    const text = await transformed.text()

    assert.ok(
      text.includes('"name": "search"'),
      `Expected stripped name in: ${text}`,
    )
    assert.ok(
      !text.includes("mcp_search"),
      `Should not contain mcp_search in: ${text}`,
    )
  })

  it("transformResponseStream withholds output until event boundary arrives", async () => {
    const encoder = new TextEncoder()
    let sendBoundary: (() => void) | undefined

    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"name":"mcp_test"}'))
        sendBoundary = () => {
          controller.enqueue(encoder.encode("\n\n"))
          controller.close()
        }
      },
    })

    const response = new Response(source)
    const transformed = transformResponseStream(response)
    const reader = transformed.body!.getReader()

    const pending = reader.read()
    const raceTimeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 50),
    )

    const first = await Promise.race([pending, raceTimeout])
    assert.equal(
      first,
      "timeout",
      "Expected no output before boundary, but got a chunk",
    )

    sendBoundary!()

    const { done, value } = await pending
    assert.equal(done, false)
    const decoder = new TextDecoder()
    const text = decoder.decode(value)
    assert.ok(
      text.includes('"name": "test"'),
      `Expected stripped name: ${text}`,
    )
    assert.ok(
      !text.includes("mcp_test"),
      `Should not contain mcp_test: ${text}`,
    )

    const final = await reader.read()
    assert.equal(final.done, true)
  })

  describe("repairToolPairs", () => {
    it("keeps a lone tool_use and inserts an omitted tool_result", () => {
      const messages = [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_orphan", name: "search" }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "no tool_result here" }],
        },
      ]
      const result = repairToolPairs(messages)

      assert.deepEqual(result, [
        messages[0],
        {
          role: "user",
          content: [
            omittedResult("toolu_orphan"),
            { type: "text", text: "no tool_result here" },
          ],
        },
      ])
    })

    it("converts a pure orphan tool_result into stale text", () => {
      const messages = [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_orphan", content: "ok" },
          ],
        },
      ]
      const result = repairToolPairs(messages)
      assert.deepEqual(result, [
        {
          role: "user",
          content: [{ type: "text", text: "[stale tool result]\nok" }],
        },
      ])
    })

    it("preserves assistant text and tool_use while inserting an omitted tool_result", () => {
      const messages = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will search for that." },
            { type: "tool_use", id: "toolu_orphan", name: "search" },
          ],
        },
      ]
      const result = repairToolPairs(messages)
      assert.deepEqual(result, [
        messages[0],
        {
          role: "user",
          content: [omittedResult("toolu_orphan")],
        },
      ])
    })

    it("does not modify valid tool_use/tool_result pairs", () => {
      const messages = [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_valid", name: "search" }],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_valid", content: "ok" },
          ],
        },
      ]
      const result = repairToolPairs(messages)
      assert.equal(result.length, 2)
      assert.deepEqual(result, messages)
    })

    it("passes through messages with no tool blocks", () => {
      const messages = [
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "assistant", content: [{ type: "text", text: "world" }] },
      ]
      const result = repairToolPairs(messages)
      assert.deepEqual(result, messages)
    })

    it("keeps all tool_use blocks and synthesizes missing tool_results", () => {
      const messages = [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_matched", name: "search" },
            { type: "tool_use", id: "toolu_missing", name: "read" },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_matched",
              content: "ok",
            },
          ],
        },
      ]

      const result = repairToolPairs(messages)
      assert.deepEqual(result, [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_matched", name: "search" },
            { type: "tool_use", id: "toolu_missing", name: "read" },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_matched",
              content: "ok",
            },
            omittedResult("toolu_missing"),
          ],
        },
      ])
    })

    it("preserves messages with string content", () => {
      const messages = [
        { role: "user", content: "just a string" },
        { role: "assistant", content: "response string" },
      ]
      const result = repairToolPairs(messages)
      assert.deepEqual(result, messages)
    })

    it("handles multiple valid pairs without changes", () => {
      const messages = [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_a", name: "search" }],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_a", content: "a" },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_b", name: "read" }],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_b", content: "b" },
          ],
        },
      ]
      const result = repairToolPairs(messages)
      assert.deepEqual(result, messages)
    })

    it("drops delayed tool_result for a known tool_use after synthesizing the adjacent result", () => {
      const messages = [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_a", name: "search" }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "ordinary message in between" }],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_a", content: "late" },
          ],
        },
      ]

      const result = repairToolPairs(messages)
      assert.deepEqual(result, [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_a", name: "search" }],
        },
        {
          role: "user",
          content: [
            omittedResult("toolu_a"),
            { type: "text", text: "ordinary message in between" },
          ],
        },
      ])
    })
  })

  describe("ensureTrailingUser", () => {
    it("appends a user turn when messages end with an assistant message", () => {
      const messages = [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "partial..." }] },
      ]
      const result = ensureTrailingUser(messages)
      assert.equal(result.length, messages.length + 1)
      const appended = result[result.length - 1]
      assert.equal(appended.role, "user")
      const appendedContent = appended.content as Array<{
        type?: string
        text?: string
      }>
      assert.equal(appendedContent[0].type, "text")
      assert.ok(
        appendedContent[0].text?.includes(
          "not recognized as a valid tool call",
        ),
      )
      assert.deepEqual(result.slice(0, messages.length), messages)
    })

    it("leaves messages ending with a user message unchanged", () => {
      const messages = [
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ]
      const result = ensureTrailingUser(messages)
      assert.deepEqual(result, messages)
    })

    it("passes through empty message lists", () => {
      assert.deepEqual(ensureTrailingUser([]), [])
    })
  })

  it("transformBody appends a trailing user turn for prefill-restricted models", () => {
    const input = JSON.stringify({
      system: [{ type: "text", text: "prompt" }],
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: [{ type: "text", text: "thinking out loud" }],
        },
      ],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      messages: Array<{
        role: string
        content: string | Array<{ text?: string }>
      }>
    }

    const last = parsed.messages[parsed.messages.length - 1]
    assert.equal(last.role, "user")
    const content = last.content as Array<{ text?: string }>
    assert.ok(content[0].text?.includes("not recognized as a valid tool call"))
  })

  it("transformBody keeps tool_use blocks and inserts omitted tool_results", () => {
    const input = JSON.stringify({
      system: [{ type: "text", text: "prompt" }],
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_orphan", name: "search" }],
        },
        { role: "user", content: "hello" },
      ],
    })

    const output = transformBody(input)
    const parsed = JSON.parse(output as string) as {
      system: Array<{ text: string; cache_control?: unknown }>
      messages: Array<{
        role: string
        content:
          | string
          | Array<{
              type?: string
              id?: string
              name?: string
              text?: string
              tool_use_id?: string
              content?: string
              is_error?: boolean
              cache_control?: unknown
            }>
      }>
    }

    assert.equal(parsed.system.length, 2)
    assert.ok(parsed.system[0].text.startsWith("x-anthropic-billing-header:"))
    assert.equal(
      parsed.system[1].text,
      "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
    )

    assert.equal(parsed.messages.length, 3)
    assert.deepEqual(parsed.messages[0], {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_orphan", name: "mcp_Search" }],
    })

    assert.equal(parsed.messages[1].role, "user")
    assert.ok(Array.isArray(parsed.messages[1].content))
    assert.equal(parsed.messages[1].content[0].type, "tool_result")
    assert.equal(parsed.messages[1].content[0].tool_use_id, "toolu_orphan")
    assert.equal(
      parsed.messages[1].content[0].content,
      "[Tool result omitted during context management]",
    )
    assert.equal(parsed.messages[1].content[0].is_error, true)

    assert.equal(parsed.messages[2].role, "user")
    assert.ok(Array.isArray(parsed.messages[2].content))
    assert.ok(parsed.messages[2].content[0].text?.includes("prompt"))
    assert.ok(parsed.messages[2].content[0].text?.includes("hello"))
    assert.ok(parsed.messages[2].content[0].cache_control)
  })

  it("transformResponseStream flushes remaining buffered data on stream end", async () => {
    const encoder = new TextEncoder()
    const chunk1 = 'data: {"name":"mcp_alpha"}\n\n'
    const chunk2 = 'data: {"name":"mcp_beta"}'

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1))
        controller.enqueue(encoder.encode(chunk2))
        controller.close()
      },
    })

    const response = new Response(stream)
    const transformed = transformResponseStream(response)
    const text = await transformed.text()

    assert.ok(
      text.includes('"name": "alpha"'),
      `Expected alpha stripped in: ${text}`,
    )
    assert.ok(
      text.includes('"name": "beta"'),
      `Expected beta stripped in: ${text}`,
    )
    assert.ok(
      !text.includes("mcp_alpha"),
      `Should not contain mcp_alpha in: ${text}`,
    )
    assert.ok(
      !text.includes("mcp_beta"),
      `Should not contain mcp_beta in: ${text}`,
    )
  })
})
