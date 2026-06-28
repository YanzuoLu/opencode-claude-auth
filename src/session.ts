import crypto from "node:crypto"

// Stable per-process session ID. Keep the HTTP
// X-Claude-Code-Session-Id header and metadata.user_id.session_id in lockstep.
export const sessionId = crypto.randomUUID()
