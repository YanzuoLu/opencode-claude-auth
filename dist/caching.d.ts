export type AnthropicCacheControl = {
    type: "ephemeral";
    ttl?: "1h";
};
export type AnthropicSystemBlock = {
    type: "text";
    text: string;
    cache_control?: AnthropicCacheControl;
} & Record<string, unknown>;
type CacheControlBlock = {
    cache_control?: AnthropicCacheControl | null;
};
type ContentBlock = CacheControlBlock & {
    type?: string;
    text?: string;
} & Record<string, unknown>;
type Message = {
    role?: string;
    content?: string | ContentBlock[];
};
export type CacheableRequestBody = {
    system?: AnthropicSystemBlock[];
    messages: Message[];
    tools?: Array<CacheControlBlock & Record<string, unknown>>;
};
export declare function getCacheControl(isOAuth: boolean): AnthropicCacheControl;
export declare function cloneCacheControl(cacheControl: AnthropicCacheControl): AnthropicCacheControl;
export declare function applyCacheControlToLastBlock<T extends CacheControlBlock>(blocks: T[], cacheControl: AnthropicCacheControl): boolean;
export declare function applyCacheControlToLastTextBlock(blocks: ContentBlock[], cacheControl: AnthropicCacheControl): boolean;
export declare function applyClaudeCodeSystemCache(blocks: AnthropicSystemBlock[], cacheControl: AnthropicCacheControl | undefined): number;
export declare function applyPromptCaching(params: CacheableRequestBody, cacheControl?: AnthropicCacheControl): void;
export declare function normalizeCacheControlTtlOrdering(params: CacheableRequestBody): void;
export declare function countCacheControlBreakpoints(params: CacheableRequestBody): number;
export declare function enforceCacheControlLimit(params: CacheableRequestBody, maxBreakpoints: number): void;
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
export declare function alignExistingCacheControlTtl(params: CacheableRequestBody, cacheControl: AnthropicCacheControl): void;
export declare function applyCaching(parsed: CacheableRequestBody, cacheControl: AnthropicCacheControl): void;
export {};
//# sourceMappingURL=caching.d.ts.map