export declare const CCH_SEED = 5577024349156291176n;
export declare const CCH_PLACEHOLDER_STR = "cch=00000";
export declare const BILLING_SYSTEM_MARKER: Uint8Array<ArrayBuffer>;
export declare const CCH_BILLING_SEARCH_WINDOW = 150;
export declare function fallbackXXH64(data: Uint8Array, seed: bigint): bigint;
export declare function xxHash64(data: Uint8Array, seed: bigint): bigint;
export declare function patchCch(body: Uint8Array): "patched" | "no-billing-header" | "unanchored";
export declare function wrapFetchForCch(base: typeof fetch): typeof fetch;
//# sourceMappingURL=cch.d.ts.map