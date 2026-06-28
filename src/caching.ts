export type AnthropicCacheControl = { type: "ephemeral"; ttl?: "1h" }

export type AnthropicSystemBlock = {
  type: "text"
  text: string
  cache_control?: AnthropicCacheControl
} & Record<string, unknown>

type CacheControlBlock = {
  cache_control?: AnthropicCacheControl | null
}

type ContentBlock = CacheControlBlock & {
  type?: string
  text?: string
} & Record<string, unknown>

type Message = {
  role?: string
  content?: string | ContentBlock[]
}

export type CacheableRequestBody = {
  system?: AnthropicSystemBlock[]
  messages: Message[]
  tools?: Array<CacheControlBlock & Record<string, unknown>>
}

const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:"
const MAX_CACHE_BREAKPOINTS = 4

export function getCacheControl(isOAuth: boolean): AnthropicCacheControl {
  const override = process.env.OPENCODE_CLAUDE_AUTH_CACHE_TTL?.toLowerCase()
  if (override === "5m" || override === "none" || override === "off") {
    return { type: "ephemeral" }
  }
  return isOAuth ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" }
}

export function cloneCacheControl(
  cacheControl: AnthropicCacheControl,
): AnthropicCacheControl {
  return { ...cacheControl }
}

export function applyCacheControlToLastBlock<T extends CacheControlBlock>(
  blocks: T[],
  cacheControl: AnthropicCacheControl,
): boolean {
  if (blocks.length === 0) return false
  const lastIndex = blocks.length - 1
  if (blocks[lastIndex].cache_control != null) return false
  blocks[lastIndex] = {
    ...blocks[lastIndex],
    cache_control: cloneCacheControl(cacheControl),
  }
  return true
}

export function applyCacheControlToLastTextBlock(
  blocks: ContentBlock[],
  cacheControl: AnthropicCacheControl,
): boolean {
  if (blocks.length === 0) return false
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === "text") {
      if (blocks[i].cache_control != null) return false
      blocks[i] = {
        ...blocks[i],
        cache_control: cloneCacheControl(cacheControl),
      }
      return true
    }
  }

  for (let i = blocks.length - 1; i >= 0; i--) {
    const type = blocks[i].type
    if (type === "thinking" || type === "redacted_thinking") continue
    if (blocks[i].cache_control != null) return false
    blocks[i] = {
      ...blocks[i],
      cache_control: cloneCacheControl(cacheControl),
    }
    return true
  }
  return false
}

export function applyClaudeCodeSystemCache(
  blocks: AnthropicSystemBlock[],
  cacheControl: AnthropicCacheControl | undefined,
): number {
  if (!cacheControl || blocks.length === 0) return 0
  const lastIndex = blocks.length - 1
  if (blocks[lastIndex].cache_control != null) return 0
  blocks[lastIndex] = {
    ...blocks[lastIndex],
    cache_control: cloneCacheControl(cacheControl),
  }
  return 1
}

export function applyPromptCaching(
  params: CacheableRequestBody,
  cacheControl?: AnthropicCacheControl,
): void {
  if (!cacheControl) return

  let cacheBreakpointsUsed = countCacheControlBreakpoints(params)
  if (cacheBreakpointsUsed >= MAX_CACHE_BREAKPOINTS) return
  let isCCLayout = false

  if (params.system && Array.isArray(params.system) && params.system.length > 0) {
    isCCLayout =
      params.system.length >= 3 &&
      params.system[0].text?.startsWith(BILLING_HEADER_PREFIX) === true
    if (isCCLayout) {
      const placed = Math.min(
        MAX_CACHE_BREAKPOINTS - cacheBreakpointsUsed,
        applyClaudeCodeSystemCache(params.system, cacheControl),
      )
      cacheBreakpointsUsed += placed
    } else if (applyCacheControlToLastBlock(params.system, cacheControl)) {
      cacheBreakpointsUsed++
    }
  }

  if (cacheBreakpointsUsed >= MAX_CACHE_BREAKPOINTS) return

  const messages = Array.isArray(params.messages) ? params.messages : []
  const start = isCCLayout
    ? Math.max(0, messages.length - 1)
    : Math.max(0, messages.length - 2)
  for (let i = start; i < messages.length; i++) {
    if (cacheBreakpointsUsed >= MAX_CACHE_BREAKPOINTS) break
    const message = messages[i]
    if (!message) continue
    if (typeof message.content === "string") {
      message.content = [
        {
          type: "text",
          text: message.content,
          cache_control: cloneCacheControl(cacheControl),
        },
      ]
      cacheBreakpointsUsed++
    } else if (Array.isArray(message.content) && message.content.length > 0) {
      if (applyCacheControlToLastTextBlock(message.content, cacheControl)) {
        cacheBreakpointsUsed++
      }
    }
  }
}

function normalizeCacheControlBlockTtl(
  block: CacheControlBlock,
  seenFiveMinute: { value: boolean },
): void {
  const cacheControl = block.cache_control
  if (!cacheControl) return
  if (cacheControl.ttl !== "1h") {
    seenFiveMinute.value = true
    return
  }
  if (seenFiveMinute.value) {
    const normalized = cloneCacheControl(cacheControl)
    delete normalized.ttl
    block.cache_control = normalized
  }
}

export function normalizeCacheControlTtlOrdering(
  params: CacheableRequestBody,
): void {
  const seenFiveMinute = { value: false }
  if (params.tools) {
    for (const tool of params.tools) {
      normalizeCacheControlBlockTtl(tool, seenFiveMinute)
    }
  }
  if (params.system && Array.isArray(params.system)) {
    for (const block of params.system) {
      normalizeCacheControlBlockTtl(block, seenFiveMinute)
    }
  }
  const messages = Array.isArray(params.messages) ? params.messages : []
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      normalizeCacheControlBlockTtl(block, seenFiveMinute)
    }
  }
}

function findLastCacheControlIndex<T extends CacheControlBlock>(
  blocks: T[],
): number {
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index]?.cache_control != null) return index
  }
  return -1
}

function stripCacheControlExceptIndex<T extends CacheControlBlock>(
  blocks: T[],
  preserveIndex: number,
  excessCounter: { value: number },
): void {
  for (let index = 0; index < blocks.length && excessCounter.value > 0; index++) {
    if (index === preserveIndex) continue
    if (!blocks[index]?.cache_control) continue
    delete blocks[index].cache_control
    excessCounter.value--
  }
}

function stripAllCacheControl<T extends CacheControlBlock>(
  blocks: T[],
  excessCounter: { value: number },
): void {
  for (const block of blocks) {
    if (excessCounter.value <= 0) return
    if (!block.cache_control) continue
    delete block.cache_control
    excessCounter.value--
  }
}

function stripMessageCacheControl(
  messages: Message[],
  excessCounter: { value: number },
): void {
  for (const message of messages) {
    if (excessCounter.value <= 0) return
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (excessCounter.value <= 0) return
      if (!block.cache_control) continue
      delete block.cache_control
      excessCounter.value--
    }
  }
}

export function countCacheControlBreakpoints(
  params: CacheableRequestBody,
): number {
  let total = 0
  if (params.tools) {
    for (const tool of params.tools) {
      if (tool.cache_control) total++
    }
  }
  if (params.system && Array.isArray(params.system)) {
    for (const block of params.system) {
      if (block.cache_control) total++
    }
  }
  const messages = Array.isArray(params.messages) ? params.messages : []
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.cache_control) total++
    }
  }
  return total
}

export function enforceCacheControlLimit(
  params: CacheableRequestBody,
  maxBreakpoints: number,
): void {
  const total = countCacheControlBreakpoints(params)
  if (total <= maxBreakpoints) return

  const excessCounter = { value: total - maxBreakpoints }
  const systemBlocks =
    params.system && Array.isArray(params.system) ? params.system : []
  const toolBlocks = params.tools ?? []
  const lastSystemIndex = findLastCacheControlIndex(systemBlocks)
  const lastToolIndex = findLastCacheControlIndex(toolBlocks)

  if (systemBlocks.length > 0) {
    stripCacheControlExceptIndex(systemBlocks, lastSystemIndex, excessCounter)
  }
  if (excessCounter.value <= 0) return
  if (toolBlocks.length > 0) {
    stripCacheControlExceptIndex(toolBlocks, lastToolIndex, excessCounter)
  }
  if (excessCounter.value <= 0) return
  stripMessageCacheControl(params.messages, excessCounter)
  if (excessCounter.value <= 0) return
  if (systemBlocks.length > 0) {
    stripAllCacheControl(systemBlocks, excessCounter)
  }
  if (excessCounter.value <= 0) return
  if (toolBlocks.length > 0) {
    stripAllCacheControl(toolBlocks, excessCounter)
  }
}

/**
 * Align the TTL of cache_control breakpoints injected by an upstream layer
 * (e.g. OpenCode / the AI SDK already mark the system block and recent messages
 * with a 5-minute `{ type: "ephemeral" }`) to the retention we actually want.
 *
 * omp never needs this because it owns the entire request and is the only layer
 * that writes cache_control. In this plugin we intercept a body that already has
 * foreign 5m breakpoints; without this pass `applyPromptCaching` would skip those
 * blocks (they already have cache_control) and the 1h retention would never take
 * effect — leaving every request on the 5m cache and defeating the whole patch.
 */
export function alignExistingCacheControlTtl(
  params: CacheableRequestBody,
  cacheControl: AnthropicCacheControl,
): void {
  const align = (block: CacheControlBlock | undefined): void => {
    if (!block || block.cache_control == null) return
    block.cache_control = cloneCacheControl(cacheControl)
  }
  if (params.tools) {
    for (const tool of params.tools) align(tool)
  }
  if (Array.isArray(params.system)) {
    for (const block of params.system) align(block)
  }
  const messages = Array.isArray(params.messages) ? params.messages : []
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) align(block)
  }
}

export function applyCaching(
  parsed: CacheableRequestBody,
  cacheControl: AnthropicCacheControl,
): void {
  alignExistingCacheControlTtl(parsed, cacheControl)
  applyPromptCaching(parsed, cacheControl)
  enforceCacheControlLimit(parsed, MAX_CACHE_BREAKPOINTS)
  normalizeCacheControlTtlOrdering(parsed)
}
