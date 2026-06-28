# opencode-claude-auth

GitHub-only fork: <https://github.com/YanzuoLu/opencode-claude-auth>

Self-contained Anthropic auth provider for OpenCode using your Claude Code credentials — no separate login or API key needed.

This fork adds omp-style Anthropic OAuth request shaping: `local-agent` / Claude Agent SDK identity, real cch billing-header attestation, 1-hour prompt-cache retention, stable cache breakpoints, OMP/Claude Code-style 1M model suffix aliases, and third-party system-prompt relocation by default to preserve Claude Code billing behavior.

## How it works

The plugin registers its own auth provider with a custom fetch handler that intercepts all Anthropic API requests. It reads OAuth tokens from the macOS Keychain (or `~/.claude/.credentials.json` on other platforms), caches them in memory with a 30-second TTL, and handles the full request lifecycle — no builtin Anthropic auth plugin required. On macOS, multiple Claude Code accounts are detected automatically and can be switched via `opencode auth login`.

It also syncs credentials to OpenCode's `auth.json` as a fallback (on Windows, it writes to both `%USERPROFILE%\.local\share\opencode\auth.json` and `%LOCALAPPDATA%\opencode\auth.json` to cover all installation methods). If a token is near expiry, it refreshes directly via Anthropic's OAuth endpoint (zero LLM tokens consumed), falling back to the Claude CLI if the direct refresh fails. Background re-sync runs every 5 minutes.

## Prerequisites

- Claude Code installed and authenticated (run `claude` at least once)
- OpenCode installed

macOS is preferred (uses Keychain). Linux and Windows work via the credentials file fallback.

## Installation

**For Humans**

**Option A: Let an LLM do it**

Paste this into any LLM agent (Claude Code, OpenCode, Cursor, etc.):

```
Install the YanzuoLu/opencode-claude-auth fork and configure it by following: https://raw.githubusercontent.com/YanzuoLu/opencode-claude-auth/main/installation.md
```

**Option B: Manual setup**

1. **Add the plugin** to `~/.config/opencode/opencode.json`:

   ```json
   {
     "plugin": [
       "git+https://github.com/YanzuoLu/opencode-claude-auth.git#v1.5.4-cc4"
     ]
   }
   ```

   > This fork is distributed from GitHub tags, not npm. The tag includes compiled `dist/` files so OpenCode can load it directly. No manual `npm install` is needed — OpenCode [automatically installs plugins using Bun at startup](https://opencode.ai/docs/plugins/#how-plugins-are-installed).

   If your OpenCode build does not accept git package specs, clone and build this repo, then use the local file path instead:

   ```json
   {
     "plugin": ["/path/to/opencode-claude-auth/opencode-claude-auth.js"]
   }
   ```

2. **Use it** — just run OpenCode. The plugin handles auth automatically using your Claude Code credentials.

**For LLM Agents**

See [installation.md](installation.md) for step-by-step agent instructions.

## Usage

Just run OpenCode. The plugin handles auth automatically — it reads your Claude Code credentials, provides them to the Anthropic API, and refreshes them in the background. If your credentials aren't OAuth-based, the plugin falls through to standard API key auth.

## Supported models

Supported model aliases are listed below. Note: the inherited `scripts/test-models.ts` smoke helper predates this fork's transform/cch/cache path and should not be used as the release gate for this fork.

| Model                      |
| -------------------------- |
| claude-haiku-4-5           |
| claude-haiku-4-5-20251001  |
| claude-opus-4-0            |
| claude-opus-4-1            |
| claude-opus-4-1-20250805   |
| claude-opus-4-20250514     |
| claude-opus-4-5            |
| claude-opus-4-5-20251101   |
| claude-opus-4-6            |
| claude-opus-4-6[1m]        |
| claude-opus-4-6-1m         |
| claude-opus-4-7            |
| claude-opus-4-7[1m]        |
| claude-opus-4-7-1m         |
| claude-sonnet-4-0          |
| claude-sonnet-4-20250514   |
| claude-sonnet-4-5          |
| claude-sonnet-4-5-20250929 |
| claude-sonnet-4-6          |
| claude-sonnet-4-6[1m]      |
| claude-sonnet-4-6-1m       |

If OpenCode's Anthropic provider includes `claude-fable-5`, `claude-opus-4-8`, or other default-1M OMP models, this plugin also exposes matching `[1m]` and `-1m` aliases dynamically.

## Credential sources

The plugin checks these in order:

1. macOS Keychain (all `Claude Code-credentials*` entries — multiple accounts are detected automatically)
2. `~/.claude/.credentials.json` (fallback, works on all platforms)

## Multiple accounts (macOS)

If you have [multiple Claude Code accounts](https://gist.github.com/KMJ-007/0979814968722051620461ab2aa01bf2) authenticated on macOS, the plugin detects all of them from the Keychain automatically. Each account is labeled by its subscription tier (Claude Pro, Claude Max, etc.).

To switch accounts:

```bash
opencode auth login
```

Select "Switch Claude Code account" and pick the account you want to use. Your selection is persisted across sessions.

If only one account is found, the switcher is hidden and the plugin uses it directly.

## Troubleshooting

| Problem                                             | Solution                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| "Credentials not found"                             | Run `claude` to authenticate with Claude Code first                                                                |
| "Keychain is locked"                                | Run `security unlock-keychain ~/Library/Keychains/login.keychain-db`                                               |
| "Token expired and refresh failed"                  | The plugin runs `claude` CLI to refresh automatically. If this fails, re-authenticate manually by running `claude` |
| Not working on Linux/Windows                        | Ensure `~/.claude/.credentials.json` exists. Run `claude` to create it                                             |
| Keychain access denied                              | Grant access when macOS prompts you                                                                                |
| Keychain read timed out                             | Restart Keychain Access (can happen on macOS Tahoe)                                                                |
| "Credentials are unavailable or expired"            | Run `claude` to refresh your Claude Code credentials                                                               |
| "Extra usage is required for long context requests" | Your conversation exceeded 200k tokens. See [Long context (1M)](#long-context-1m) below                            |
| Plugin not updating to the GitHub tag               | Delete cached plugin packages: `rm -rf ~/.cache/opencode/packages/*opencode-claude-auth*` then restart OpenCode    |

### Diagnostic logging

If you're hitting auth errors that are hard to reproduce, enable debug logging to capture the full auth flow:

```bash
export CLAUDE_AUTH_DEBUG=1
```

Restart OpenCode and reproduce the issue. The plugin writes structured JSON logs to `~/.local/share/opencode/claude-auth-debug.log`. All secrets (tokens, API keys) are automatically redacted — the log file is safe to paste into a GitHub issue.

To write logs to a custom path:

```bash
export CLAUDE_AUTH_DEBUG=/tmp/claude-auth-debug.log
```

Disable when done:

```bash
unset CLAUDE_AUTH_DEBUG
```

## Long context (1M)

The plugin follows OMP / Claude Code model-selection semantics for 1M context:

- `claude-sonnet-4-6[1m]`, `claude-sonnet-4-6-1m`, `claude-opus-4-6[1m]`, and `claude-opus-4-6-1m` opt those 4.6 models into the `context-1m-2025-08-07` beta.
- `claude-fable-5`, `claude-opus-4-7`, and `claude-opus-4-8` are default/always 1M models when present in OpenCode's Anthropic provider; their `[1m]` / `-1m` aliases are accepted but do not add the beta.
- `claude-sonnet-4-5`, `claude-sonnet-4`, and Haiku models do not support 1M here, so no 1M aliases are exposed and no beta is added.

Before the request is sent to Anthropic, `[1m]` and `-1m` are stripped from the JSON `model` field, so Anthropic receives the base model ID (for example, `claude-sonnet-4-6`).

The recommended way to enable 1M for 4.6 models is to select the `[1m]` suffix model or the OpenCode-friendly `-1m` alias. The legacy global opt-in remains available for compatibility:

**Option A: Config file**

Add `enable1mContext` to any agent in your `opencode.json` (project-level or `~/.config/opencode/opencode.json`). Setting it in any one agent enables the 1M beta globally for Claude Sonnet/Opus 4.6 — you don't need to set it for each agent:

```json
{
  "plugin": [
    "git+https://github.com/YanzuoLu/opencode-claude-auth.git#v1.5.4-cc4"
  ],
  "agent": {
    "build": {
      "enable1mContext": true
    }
  }
}
```

**Option B: Environment variable**

```bash
export ANTHROPIC_ENABLE_1M_CONTEXT=true
```

If both are set, the environment variable takes priority.

Sending the beta without a plan that covers long context charges causes "Extra usage is required for long context requests" errors. Older upstream releases sent this beta automatically for 4.6+ models, which broke things for Pro users.

If a long context error still occurs (e.g. from a beta flag added via `ANTHROPIC_BETA_FLAGS`), the plugin retries without the offending flag.

## Validating OAuth refresh

To verify the direct OAuth token refresh works with your credentials:

```bash
npm run validate:oauth           # refresh + write-back (safe, keeps credentials valid)
npm run validate:oauth -- --dry-run  # show what would be sent without making the request
```

This reads your stored credentials, calls Anthropic's OAuth token endpoint, and writes the new tokens back to storage. Refresh tokens rotate on each use, so write-back is enabled by default to keep your stored credentials valid.

## Environment variable overrides

All configurable parameters can be overridden via environment variables. If Anthropic changes something before we publish an update, set an env var and keep working:

| Variable                               | Description                                                                                                                                                                                    | Default                                                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_BETA_FLAGS`                 | Comma-separated beta feature flags. If unset, this fork uses the local-agent Claude Code agent beta set and appends `extended-cache-ttl-2025-04-11` last.                                      | `claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,advanced-tool-use-2025-11-20` |
| `ANTHROPIC_ENABLE_1M_CONTEXT`          | Legacy global opt-in for the 1M beta on Claude Sonnet/Opus 4.6. Prefer selecting `[1m]` or `-1m` model aliases.                                                                                | `false`                                                                                                                                                                                               |
| `OPENCODE_CLAUDE_AUTH_CACHE_TTL`       | Set to `5m`, `none`, or `off` to disable the default 1-hour OAuth prompt-cache TTL and fall back to standard 5-minute ephemeral cache controls.                                                | OAuth defaults to `1h`                                                                                                                                                                                |
| `OPENCODE_CLAUDE_AUTH_KEEP_SYSTEM`     | Set to `1` to keep third-party system prompts in `system[]` instead of relocating them into the first user message. This may cause Anthropic to classify the request as third-party app usage. | disabled                                                                                                                                                                                              |
| `OPENCODE_CLAUDE_AUTH_RELOCATE_SYSTEM` | Legacy override. Set to `0`, `false`, or `off` to disable the default system relocation.                                                                                                       | enabled                                                                                                                                                                                               |
| `CLAUDE_AUTH_DEBUG`                    | Enable diagnostic logging (`1` for default path, or a custom file path)                                                                                                                        | disabled                                                                                                                                                                                              |
| `OPENCODE_CLAUDE_AUTH_MAX_RETRY_MS`    | Max ms the plugin waits when honouring a 429/529 `retry-after` header. Beyond this cap the response surfaces immediately so OpenCode doesn't appear to hang on hour-long quota resets.         | `30000`                                                                                                                                                                                               |

Example:

```bash
export ANTHROPIC_ENABLE_1M_CONTEXT=true  # legacy global 4.6 1M opt-in
export OPENCODE_CLAUDE_AUTH_CACHE_TTL=5m # rollback cache retention if needed
```

## How it works (technical)

- Registers an `auth.loader` with a custom `fetch` that intercepts all Anthropic API requests
- Sets `Authorization: Bearer` with fresh OAuth tokens (cached in memory, 30s TTL, updated in-place after refresh)
- Translates tool names between OpenCode and Anthropic API formats (adds/strips `mcp_` prefix)
- Buffers SSE response streams at event boundaries for reliable tool name translation
- Injects the local-agent / Claude Agent SDK identity via `experimental.chat.system.transform`
- Sets required API headers (ordered beta flags, billing, local-agent user-agent, client/stainless headers) with model-aware selection
- Adds OMP/Claude Code-style `[1m]` and `-1m` model aliases for eligible Anthropic models, then strips the suffix before sending the model ID to Anthropic
- Patches the OAuth billing-header `cch=00000` placeholder at fetch time using `xxHash64(fullBody, seed)` before sending the request
- Applies 1-hour OAuth prompt caching by upgrading existing OpenCode/AI-SDK 5-minute cache breakpoints and enforcing the Anthropic 4-breakpoint limit
- Relocates third-party system prompts into the first user message by default, matching omp/Claude Code billing behavior; set `OPENCODE_CLAUDE_AUTH_KEEP_SYSTEM=1` to opt out
- Adds stable JSON `metadata.user_id` with the same `session_id` as `X-Claude-Code-Session-Id`
- On macOS, enumerates all `Claude Code-credentials*` Keychain entries and labels them by subscription tier
- Provides an account switcher via `opencode auth login` when multiple accounts are found; persists selection to `~/.local/share/opencode/claude-account-source.txt`
- Syncs credentials to `auth.json` on startup and every 5 minutes as a fallback (sync never triggers refresh; refresh is lazy, only on API requests)
- On Windows, writes to both `%USERPROFILE%\.local\share\opencode\auth.json` and `%LOCALAPPDATA%\opencode\auth.json`
- Retries API requests on 429 (rate limit) and 529 (overloaded) with exponential backoff, respecting `retry-after` headers
- When a token is within 60 seconds of expiry, refreshes directly via `POST https://claude.ai/v1/oauth/token` (no LLM tokens consumed). Falls back to `claude` CLI if the direct refresh fails. New tokens are written back to Keychain (macOS) or credentials file (Linux/Windows) to keep stored credentials in sync with rotated refresh tokens
- If credentials aren't OAuth-based, the auth loader returns `{}` and falls through to API key auth
- If credentials are unavailable or unreadable, the plugin disables itself and OpenCode continues without Claude auth

## Disclaimer

This plugin uses Claude Code's OAuth credentials to authenticate with Anthropic's API. Anthropic's Terms of Service state that Claude Pro/Max subscription tokens should only be used with official Anthropic clients. This plugin exists as a community workaround and may stop working if Anthropic changes their OAuth infrastructure. Use at your own discretion.

## License

MIT
