import {
  applyCaching,
  getCacheControl,
  type AnthropicCacheControl,
  type CacheableRequestBody,
} from "./caching.ts"
import { buildBillingHeaderValue } from "./signing.ts"
import { config, getModelOverride } from "./model-config.ts"
import { sessionId } from "./session.ts"

const TOOL_PREFIX = "mcp_"

/**
 * Prefix a tool name with TOOL_PREFIX and uppercase the first character.
 * Claude Code uses PascalCase tool names (e.g. mcp_Bash, mcp_Read);
 * lowercase names (mcp_bash, mcp_read) are flagged as non-Claude-Code clients.
 */
function prefixName(name: string): string {
  return `${TOOL_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

/**
 * Reverse prefixName: strip TOOL_PREFIX and restore the original leading case.
 */
function unprefixName(name: string): string {
  return `${name.charAt(0).toLowerCase()}${name.slice(1)}`
}

export const SYSTEM_IDENTITY =
  "You are a Claude agent, built on Anthropic's Claude Agent SDK."

const BILLING_PREFIX = "x-anthropic-billing-header:"

type SystemEntry = {
  type: "text"
  text: string
  cache_control?: AnthropicCacheControl
} & Record<string, unknown>
type ContentBlock = {
  type?: string
  text?: string
  cache_control?: AnthropicCacheControl
} & Record<string, unknown>
type Message = {
  role?: string
  content?: string | ContentBlock[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function canonicalTextEntry(
  entry: Record<string, unknown>,
  text: string,
): SystemEntry {
  const { type: _type, text: _text, ...rest } = entry
  return { type: "text", text, ...rest }
}

function normalizeSystemEntries(system: unknown): SystemEntry[] {
  if (typeof system === "string") return [{ type: "text", text: system }]
  if (!Array.isArray(system)) return []

  const entries: SystemEntry[] = []
  for (const entry of system) {
    if (typeof entry === "string") {
      entries.push({ type: "text", text: entry })
      continue
    }
    if (!isRecord(entry) || typeof entry.text !== "string") continue
    const type = typeof entry.type === "string" ? entry.type : "text"
    if (type !== "text") continue
    entries.push(canonicalTextEntry(entry, entry.text))
  }
  return entries
}

function withoutCacheControl(entry: SystemEntry): SystemEntry {
  const { cache_control: _cacheControl, ...rest } = entry
  return rest as SystemEntry
}

function buildSystemLayout(parsed: {
  system?: unknown
  messages?: Message[]
}): SystemEntry[] {
  const billingHeader = buildBillingHeaderValue(
    parsed.messages ?? [],
    config.ccVersion,
  )
  const existing = normalizeSystemEntries(parsed.system)
  let agentInstruction: SystemEntry | undefined
  const remaining: SystemEntry[] = []

  for (const entry of existing) {
    if (entry.text.startsWith(BILLING_PREFIX)) continue

    if (entry.text === SYSTEM_IDENTITY) {
      agentInstruction ??= entry
      continue
    }

    if (entry.text.startsWith(SYSTEM_IDENTITY)) {
      const rest = entry.text.slice(SYSTEM_IDENTITY.length).replace(/^\n+/, "")
      agentInstruction ??= withoutCacheControl({
        ...entry,
        text: SYSTEM_IDENTITY,
      })
      if (rest.length > 0) {
        remaining.push({ ...entry, text: rest })
      }
      continue
    }

    remaining.push(entry)
  }

  return [
    { type: "text", text: billingHeader },
    agentInstruction ?? { type: "text", text: SYSTEM_IDENTITY },
    ...remaining,
  ]
}

function applyLegacySystemRelocation(parsed: {
  system?: SystemEntry[]
  messages?: Message[]
}): void {
  if (!Array.isArray(parsed.system)) return

  const keptSystem: SystemEntry[] = []
  const movedTexts: string[] = []
  for (const entry of parsed.system) {
    const text = entry.text ?? ""
    if (text.startsWith(BILLING_PREFIX) || text.startsWith(SYSTEM_IDENTITY)) {
      keptSystem.push(entry)
    } else if (text.length > 0) {
      movedTexts.push(text)
    }
  }

  if (movedTexts.length === 0 || !Array.isArray(parsed.messages)) return
  const firstUser = parsed.messages.find((message) => message.role === "user")
  if (!firstUser) return

  parsed.system = keptSystem
  const prefix = movedTexts.join("\n\n")
  if (typeof firstUser.content === "string") {
    firstUser.content = `${prefix}\n\n${firstUser.content}`
  } else if (Array.isArray(firstUser.content)) {
    firstUser.content.unshift({ type: "text", text: prefix })
  }
}

function injectMetadataUserId(parsed: { metadata?: unknown }): void {
  const metadata = isRecord(parsed.metadata) ? parsed.metadata : {}
  let existing: Record<string, unknown> = {}
  if (typeof metadata.user_id === "string" && metadata.user_id.length > 0) {
    try {
      const parsedUserId = JSON.parse(metadata.user_id) as unknown
      if (isRecord(parsedUserId)) existing = parsedUserId
    } catch {
      // Non-JSON user_id values are not Claude JSON metadata; normalize below.
    }
  }
  parsed.metadata = {
    ...metadata,
    user_id: JSON.stringify({ ...existing, session_id: sessionId }),
  }
}

function isThinkingEnabled(thinking: unknown): boolean {
  if (!isRecord(thinking)) return false
  if (thinking.type === "enabled") return true
  return thinking.budget_tokens != null || thinking.budget != null
}

export function repairToolPairs(messages: Message[]): Message[] {
  // Collect all tool_use ids and tool_result tool_use_ids
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()

  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      const id = block["id"]
      if (block.type === "tool_use" && typeof id === "string") {
        toolUseIds.add(id)
      }
      const toolUseId = block["tool_use_id"]
      if (block.type === "tool_result" && typeof toolUseId === "string") {
        toolResultIds.add(toolUseId)
      }
    }
  }

  // Find orphaned IDs
  const orphanedUses = new Set<string>()
  for (const id of toolUseIds) {
    if (!toolResultIds.has(id)) orphanedUses.add(id)
  }
  const orphanedResults = new Set<string>()
  for (const id of toolResultIds) {
    if (!toolUseIds.has(id)) orphanedResults.add(id)
  }

  // Early return if nothing to fix
  if (orphanedUses.size === 0 && orphanedResults.size === 0) {
    return messages
  }

  // Filter orphaned blocks and remove messages with empty content arrays
  return messages
    .map((message) => {
      if (!Array.isArray(message.content)) return message
      const filtered = message.content.filter((block) => {
        const id = block["id"]
        if (block.type === "tool_use" && typeof id === "string") {
          return !orphanedUses.has(id)
        }
        const toolUseId = block["tool_use_id"]
        if (block.type === "tool_result" && typeof toolUseId === "string") {
          return !orphanedResults.has(toolUseId)
        }
        return true
      })
      return { ...message, content: filtered }
    })
    .filter(
      (message) =>
        !(Array.isArray(message.content) && message.content.length === 0),
    )
}

export function transformBody(
  body: BodyInit | null | undefined,
): BodyInit | null | undefined {
  if (typeof body !== "string") {
    return body
  }

  try {
    const parsed = JSON.parse(body) as {
      model?: string
      system?: unknown
      thinking?: Record<string, unknown>
      // eslint-disable-next-line @typescript-eslint/naming-convention
      output_config?: Record<string, unknown>
      context_management?: unknown
      max_tokens?: unknown
      metadata?: unknown
      tools?: Array<{ name?: string } & Record<string, unknown>>
      messages?: Message[]
    }

    parsed.system = buildSystemLayout(parsed)

    // Strip effort for models that don't support it (e.g. haiku).
    // OpenCode sends { output_config: { effort: "high" } } but haiku
    // rejects the effort parameter with a 400 error.
    const modelId = parsed.model ?? ""
    const override = getModelOverride(modelId)
    if (override?.disableEffort) {
      if (parsed.output_config) {
        delete parsed.output_config.effort
        if (Object.keys(parsed.output_config).length === 0) {
          delete parsed.output_config
        }
      }
      if (parsed.thinking && "effort" in parsed.thinking) {
        delete parsed.thinking.effort
        if (Object.keys(parsed.thinking).length === 0) {
          delete parsed.thinking
        }
      }
    }

    // Anthropic's OAuth billing validation rejects lowercase tool names
    // when multiple tools are present. Claude Code uses PascalCase after
    // the mcp_ prefix (e.g. mcp_Bash, mcp_Read). Apply the same convention.
    if (Array.isArray(parsed.tools)) {
      parsed.tools = parsed.tools.map((tool) => ({
        ...tool,
        name: tool.name ? prefixName(tool.name) : tool.name,
      }))
    }

    if (Array.isArray(parsed.messages)) {
      parsed.messages = parsed.messages.map((message) => {
        if (!Array.isArray(message.content)) {
          return message
        }

        return {
          ...message,
          content: message.content.map((block) => {
            if (block.type !== "tool_use" || typeof block.name !== "string") {
              return block
            }

            return { ...block, name: prefixName(block.name) }
          }),
        }
      })
    }

    if (Array.isArray(parsed.messages)) {
      parsed.messages = repairToolPairs(parsed.messages)
    }

    if (typeof parsed.max_tokens === "number") {
      parsed.max_tokens = Math.min(64000, parsed.max_tokens)
    }

    if (
      isThinkingEnabled(parsed.thinking) &&
      parsed.context_management === undefined
    ) {
      parsed.context_management = {
        edits: [{ type: "clear_thinking_20251015", keep: "all" }],
      }
    }

    injectMetadataUserId(parsed)

    if (process.env.OPENCODE_CLAUDE_AUTH_RELOCATE_SYSTEM === "1") {
      applyLegacySystemRelocation(
        parsed as { system?: SystemEntry[]; messages?: Message[] },
      )
    }

    if (!Array.isArray(parsed.messages)) parsed.messages = []
    applyCaching(parsed as CacheableRequestBody, getCacheControl(true))

    return JSON.stringify(parsed)
  } catch {
    return body
  }
}

export function stripToolPrefix(text: string): string {
  return text.replace(
    /"name"\s*:\s*"mcp_([^"]+)"/g,
    (_match, name: string) => `"name": "${unprefixName(name)}"`,
  )
}

export function transformResponseStream(response: Response): Response {
  if (!response.body) {
    return response
  }

  // Don't wrap error responses through the SSE parser — pass them through
  // with only tool-prefix stripping on the raw body. This preserves error
  // messages for OpenCode / AI SDK to handle properly.
  if (!response.ok) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    const passthrough = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        const text = decoder.decode(value, { stream: true })
        controller.enqueue(encoder.encode(stripToolPrefix(text)))
      },
    })

    return new Response(passthrough, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""

  const stream = new ReadableStream({
    async pull(controller) {
      for (;;) {
        const boundary = buffer.indexOf("\n\n")
        if (boundary !== -1) {
          const completeEvent = buffer.slice(0, boundary + 2)
          buffer = buffer.slice(boundary + 2)
          controller.enqueue(encoder.encode(stripToolPrefix(completeEvent)))
          return
        }

        const { done, value } = await reader.read()

        if (done) {
          if (buffer) {
            controller.enqueue(encoder.encode(stripToolPrefix(buffer)))
            buffer = ""
          }
          controller.close()
          return
        }

        buffer += decoder.decode(value, { stream: true })
      }
    },
  })

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
