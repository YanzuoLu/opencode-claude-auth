import { config, getModelOverride } from "./model-config.js";
import { isEnable1mContext } from "./plugin-config.js";
// Beta flags to try removing in order when "long context" errors occur
export const LONG_CONTEXT_BETAS = config.longContextBetas;
export const EXTENDED_CACHE_TTL_BETA = "extended-cache-ttl-2025-04-11";
export const ONE_M_CONTEXT_BETA = config.longContextBetas[0];
function appendBeta(betas, beta) {
    if (!betas.includes(beta))
        betas.push(beta);
}
function getRequiredBetas() {
    return (process.env.ANTHROPIC_BETA_FLAGS ?? config.baseBetas.join(","))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
// Session-level cache of excluded beta flags per model (resets on process restart)
const excludedBetas = new Map();
// Track the last-seen beta flags env var and model to detect changes
let lastBetaFlagsEnv = process.env.ANTHROPIC_BETA_FLAGS;
let lastModelId;
export function getExcludedBetas(modelId) {
    // Reset exclusions if user changed ANTHROPIC_BETA_FLAGS
    const currentBetaFlags = process.env.ANTHROPIC_BETA_FLAGS;
    if (currentBetaFlags !== lastBetaFlagsEnv) {
        excludedBetas.clear();
        lastBetaFlagsEnv = currentBetaFlags;
    }
    // Reset exclusions if user switched models (new model may support different betas)
    if (lastModelId !== undefined && lastModelId !== modelId) {
        excludedBetas.clear();
    }
    lastModelId = modelId;
    return excludedBetas.get(modelId) ?? new Set();
}
export function addExcludedBeta(modelId, beta) {
    const existing = excludedBetas.get(modelId) ?? new Set();
    existing.add(beta);
    excludedBetas.set(modelId, existing);
}
export function resetExcludedBetas() {
    excludedBetas.clear();
    lastModelId = undefined;
}
export function isLongContextError(responseBody) {
    return (responseBody.includes("Extra usage is required for long context requests") ||
        responseBody.includes("long context beta is not yet available") ||
        responseBody.includes("You're out of extra usage"));
}
export function normalize1mModelId(modelId) {
    if (/\[1m\]$/i.test(modelId)) {
        return { modelId: modelId.slice(0, -"[1m]".length), requested1m: true };
    }
    if (/-1m$/i.test(modelId)) {
        return { modelId: modelId.slice(0, -"-1m".length), requested1m: true };
    }
    return { modelId, requested1m: false };
}
export function normalizeModelId(modelId) {
    return normalize1mModelId(modelId).modelId;
}
export function getNextBetaToExclude(modelId) {
    const excluded = getExcludedBetas(modelId);
    for (const beta of LONG_CONTEXT_BETAS) {
        if (!excluded.has(beta)) {
            return beta;
        }
    }
    return null; // All long-context betas already excluded
}
export function supports1mContext(modelId) {
    const lower = normalizeModelId(modelId).toLowerCase();
    return modelHasDefault1mContext(lower) || modelSupports1mBetaOptIn(lower);
}
export function modelHasDefault1mContext(modelId) {
    const lower = normalizeModelId(modelId).toLowerCase();
    return (/^claude-(?:fable|mythos)-5(?:-\d{8})?$/.test(lower) ||
        /^claude-opus-4-[78](?:-fast)?(?:-\d{8})?$/.test(lower));
}
function modelSupports1mBetaOptIn(modelId) {
    const lower = normalizeModelId(modelId).toLowerCase();
    return /^claude-(?:opus|sonnet)-4-6(?:-fast)?(?:-\d{8})?$/.test(lower);
}
export function shouldAdd1mContextBeta(modelId) {
    const normalized = normalize1mModelId(modelId);
    if (!modelSupports1mBetaOptIn(normalized.modelId))
        return false;
    if (modelHasDefault1mContext(normalized.modelId))
        return false;
    return normalized.requested1m || isEnable1mContext();
}
export function getModelBetas(modelId, excluded) {
    const normalizedModelId = normalizeModelId(modelId);
    const betas = getRequiredBetas().filter((beta) => beta !== EXTENDED_CACHE_TTL_BETA);
    // context-1m is OPT-IN only, matching the official Claude CLI behavior.
    // The CLI only sends this beta when the model ID has a [1m] suffix.
    // Without it, the API enforces a 200k context limit. Sending the beta
    // without a subscription that covers long context billing causes
    // "Extra usage is required for long context requests" errors.
    //
    // Users who want 1M context should prefer selecting the `-1m` model alias
    // (Claude Sonnet/Opus 4.6). The legacy ANTHROPIC_ENABLE_1M_CONTEXT=true /
    // enable1mContext opt-in remains supported for 4.6 compatibility.
    if (shouldAdd1mContextBeta(modelId)) {
        appendBeta(betas, ONE_M_CONTEXT_BETA);
    }
    // Apply per-model overrides (e.g. haiku excludes claude-code-20250219)
    const override = getModelOverride(normalizedModelId);
    if (override) {
        if (override.exclude) {
            for (const ex of override.exclude) {
                const idx = betas.indexOf(ex);
                if (idx !== -1)
                    betas.splice(idx, 1);
            }
        }
        if (override.add) {
            for (const add of override.add) {
                if (add !== EXTENDED_CACHE_TTL_BETA)
                    appendBeta(betas, add);
            }
        }
    }
    appendBeta(betas, EXTENDED_CACHE_TTL_BETA);
    // Filter out excluded betas (from previous failed requests due to long context errors)
    if (excluded && excluded.size > 0) {
        return betas.filter((beta) => !excluded.has(beta));
    }
    return betas;
}
//# sourceMappingURL=betas.js.map