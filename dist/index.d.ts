import type { Plugin } from "@opencode-ai/plugin";
export { addExcludedBeta, getExcludedBetas, getModelBetas, getNextBetaToExclude, isLongContextError, LONG_CONTEXT_BETAS, modelHasDefault1mContext, normalize1mModelId, normalizeModelId, shouldAdd1mContextBeta, supports1mContext, } from "./betas.ts";
export { resetExcludedBetas } from "./betas.ts";
export { stripToolPrefix, transformBody, transformResponseStream, } from "./transforms.ts";
export { getCachedCredentials, syncAuthJson, refreshAccountsList, type ClaudeCredentials, } from "./credentials.ts";
export { isEnable1mContext, type PluginSettings } from "./plugin-config.ts";
export { buildBillingHeaderValue, computeVersionSuffix, extractFirstUserMessageText, } from "./signing.ts";
type FetchFn = typeof fetch;
type ProviderModelInfo = {
    id?: string;
    name?: string;
    api?: Record<string, unknown>;
    limit?: Record<string, unknown>;
    cost?: unknown;
} & Record<string, unknown>;
export declare function add1mModelAliases<T extends Record<string, ProviderModelInfo>>(models: T): T;
export declare function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, retries?: number, fetchImpl?: FetchFn): Promise<Response>;
export declare function buildRequestHeaders(input: RequestInfo | URL, init: RequestInit, accessToken: string, modelId?: string, excludedBetas?: Set<string>): Headers;
declare const plugin: Plugin;
export declare const ClaudeAuthPlugin: Plugin;
export default plugin;
//# sourceMappingURL=index.d.ts.map