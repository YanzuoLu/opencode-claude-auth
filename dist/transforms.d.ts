import { type AnthropicCacheControl } from "./caching.ts";
export declare const SYSTEM_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
type ContentBlock = {
    type?: string;
    text?: string;
    cache_control?: AnthropicCacheControl;
} & Record<string, unknown>;
type Message = {
    role?: string;
    content?: string | ContentBlock[];
};
export declare function repairToolPairs(messages: Message[]): Message[];
/**
 * Anthropic prefill-restricted models (e.g. extended-thinking Opus) reject a
 * request whose messages end with an assistant turn — "This model does not
 * support assistant message prefill. The conversation must end with a user
 * message." OpenCode can produce that shape when an assistant turn emits text
 * after a tool call (the trailing content is split into its own assistant
 * message), when a background tool call keeps the turn open, or when auto
 * compaction stops mid-turn.
 *
 * Append a user turn so the request always ends with a user message. The text
 * is diagnostic rather than a bare "continue": when the trailing assistant turn
 * was actually an unrecognized/malformed tool call, the offending content stays
 * in context as a negative example and this note tells the model to re-issue the
 * call correctly; when it was just ordinary trailing text, the model simply
 * continues.
 */
export declare function ensureTrailingUser(messages: Message[]): Message[];
export declare function transformBody(body: BodyInit | null | undefined): BodyInit | null | undefined;
export declare function stripToolPrefix(text: string): string;
export declare function transformResponseStream(response: Response): Response;
export {};
//# sourceMappingURL=transforms.d.ts.map