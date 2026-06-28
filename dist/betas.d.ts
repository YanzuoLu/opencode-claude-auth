export declare const LONG_CONTEXT_BETAS: string[];
export declare const EXTENDED_CACHE_TTL_BETA = "extended-cache-ttl-2025-04-11";
export declare const ONE_M_CONTEXT_BETA: string;
type NormalizedModelId = {
    modelId: string;
    requested1m: boolean;
};
export declare function getExcludedBetas(modelId: string): Set<string>;
export declare function addExcludedBeta(modelId: string, beta: string): void;
export declare function resetExcludedBetas(): void;
export declare function isLongContextError(responseBody: string): boolean;
export declare function normalize1mModelId(modelId: string): NormalizedModelId;
export declare function normalizeModelId(modelId: string): string;
export declare function getNextBetaToExclude(modelId: string): string | null;
export declare function supports1mContext(modelId: string): boolean;
export declare function modelHasDefault1mContext(modelId: string): boolean;
export declare function shouldAdd1mContextBeta(modelId: string): boolean;
export declare function getModelBetas(modelId: string, excluded?: Set<string>): string[];
export {};
//# sourceMappingURL=betas.d.ts.map