const encoder = new TextEncoder();
export const CCH_SEED = 0x4d659218e32a3268n;
export const CCH_PLACEHOLDER_STR = "cch=00000";
const CCH_PLACEHOLDER = encoder.encode(CCH_PLACEHOLDER_STR);
export const BILLING_SYSTEM_MARKER = encoder.encode(`"system":[{"type":"text","text":"x-anthropic-billing-header:`);
export const CCH_BILLING_SEARCH_WINDOW = 150;
const MASK64 = 0xffffffffffffffffn;
const PRIME64_1 = 0x9e3779b185ebca87n;
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn;
const PRIME64_3 = 0x165667b19e3779f9n;
const PRIME64_4 = 0x85ebca77c2b2ae63n;
const PRIME64_5 = 0x27d4eb2f165667c5n;
function u64(value) {
    return value & MASK64;
}
function rotl64(value, bits) {
    const shift = BigInt(bits);
    return u64((value << shift) | (value >> (64n - shift)));
}
function round64(accumulator, input) {
    let acc = u64(accumulator + u64(input * PRIME64_2));
    acc = rotl64(acc, 31);
    return u64(acc * PRIME64_1);
}
function mergeRound64(accumulator, value) {
    let acc = accumulator ^ round64(0n, value);
    acc = u64(acc * PRIME64_1 + PRIME64_4);
    return acc;
}
function avalanche64(hash) {
    let h = hash ^ (hash >> 33n);
    h = u64(h * PRIME64_2);
    h ^= h >> 29n;
    h = u64(h * PRIME64_3);
    h ^= h >> 32n;
    return u64(h);
}
export function fallbackXXH64(data, seed) {
    const normalizedSeed = u64(seed);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const length = data.byteLength;
    let offset = 0;
    let hash;
    if (length >= 32) {
        let v1 = u64(normalizedSeed + PRIME64_1 + PRIME64_2);
        let v2 = u64(normalizedSeed + PRIME64_2);
        let v3 = normalizedSeed;
        let v4 = u64(normalizedSeed - PRIME64_1);
        const limit = length - 32;
        while (offset <= limit) {
            v1 = round64(v1, view.getBigUint64(offset, true));
            offset += 8;
            v2 = round64(v2, view.getBigUint64(offset, true));
            offset += 8;
            v3 = round64(v3, view.getBigUint64(offset, true));
            offset += 8;
            v4 = round64(v4, view.getBigUint64(offset, true));
            offset += 8;
        }
        hash = u64(rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18));
        hash = mergeRound64(hash, v1);
        hash = mergeRound64(hash, v2);
        hash = mergeRound64(hash, v3);
        hash = mergeRound64(hash, v4);
    }
    else {
        hash = u64(normalizedSeed + PRIME64_5);
    }
    hash = u64(hash + BigInt(length));
    while (offset + 8 <= length) {
        const k1 = round64(0n, view.getBigUint64(offset, true));
        hash = u64(hash ^ k1);
        hash = u64(rotl64(hash, 27) * PRIME64_1 + PRIME64_4);
        offset += 8;
    }
    if (offset + 4 <= length) {
        hash = u64(hash ^ u64(BigInt(view.getUint32(offset, true)) * PRIME64_1));
        hash = u64(rotl64(hash, 23) * PRIME64_2 + PRIME64_3);
        offset += 4;
    }
    while (offset < length) {
        hash = u64(hash ^ u64(BigInt(data[offset]) * PRIME64_5));
        hash = u64(rotl64(hash, 11) * PRIME64_1);
        offset++;
    }
    return avalanche64(hash);
}
export function xxHash64(data, seed) {
    const bunXXH64 = globalThis.Bun?.hash?.xxHash64;
    if (bunXXH64)
        return bunXXH64(data, seed);
    return fallbackXXH64(data, seed);
}
export function patchCch(body) {
    const view = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    const markerIdx = view.indexOf(BILLING_SYSTEM_MARKER);
    if (markerIdx === -1)
        return "no-billing-header";
    const searchFrom = markerIdx + BILLING_SYSTEM_MARKER.length;
    const idx = view.indexOf(CCH_PLACEHOLDER, searchFrom);
    if (idx === -1 || idx - searchFrom > CCH_BILLING_SEARCH_WINDOW) {
        return "unanchored";
    }
    const cch = (xxHash64(body, CCH_SEED) & 0xfffffn)
        .toString(16)
        .padStart(5, "0");
    for (let i = 0; i < 5; i++) {
        body[idx + 4 + i] = cch.charCodeAt(i);
    }
    return "patched";
}
export function wrapFetchForCch(base) {
    return ((input, init) => {
        if (init?.body &&
            typeof init.body === "string" &&
            init.body.includes(CCH_PLACEHOLDER_STR)) {
            const encoded = encoder.encode(init.body);
            if (patchCch(encoded) === "unanchored") {
                console.warn("opencode-claude-auth: cch billing placeholder present but not patched; sending unattested request");
            }
            return base(input, { ...init, body: encoded });
        }
        return base(input, init);
    });
}
//# sourceMappingURL=cch.js.map