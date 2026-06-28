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
export declare function transformBody(body: BodyInit | null | undefined): BodyInit | null | undefined;
export declare function stripToolPrefix(text: string): string;
export declare function transformResponseStream(response: Response): Response;
export {};
//# sourceMappingURL=transforms.d.ts.map