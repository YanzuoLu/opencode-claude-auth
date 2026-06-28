interface Message {
    role?: string;
    content?: string | Array<{
        type?: string;
        text?: string;
    }>;
}
/**
 * Extract text from the first user message's first text block.
 * Matches Claude Code's K19() function exactly: find the first message
 * with role "user", then return the text of its first text content block.
 */
export declare function extractFirstUserMessageText(messages: Message[]): string;
/**
 * Compute the 3-char version suffix.
 * Samples characters at indices 4, 7, 20 from the message text (padding
 * with "0" when the message is shorter), then hashes with the billing salt
 * and version string.
 */
export declare function computeVersionSuffix(messageText: string, version: string): string;
/**
 * Build the complete billing header string for insertion into system[0].
 * Format: x-anthropic-billing-header: cc_version=V.S; cc_entrypoint=local-agent; cch=00000;
 */
export declare function buildBillingHeaderValue(messages: Message[], version: string): string;
export {};
//# sourceMappingURL=signing.d.ts.map