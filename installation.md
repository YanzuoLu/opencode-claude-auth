# Install opencode-claude-auth

These instructions are designed for AI coding agents.

## Prerequisites

Before installing, verify you have OpenCode and Claude Code installed and authenticated.

### Check OpenCode version

```bash
opencode --version
```

You should see a version number (e.g., `1.2.28`).

### Check Claude Code credentials (macOS)

```bash
security find-generic-password -s "Claude Code-credentials" -w
```

If this returns credentials, you're authenticated. If it fails or returns nothing, try the fallback:

### Check Claude Code credentials (fallback for all platforms)

```bash
cat ~/.claude/.credentials.json
```

If this file exists and contains valid JSON, you're authenticated.

### If credentials don't exist

Run Claude Code to authenticate:

```bash
claude
```

This will prompt you to log in and store credentials in Keychain (macOS) or `~/.claude/.credentials.json` (other platforms).

## Installation

### Step 1: Add to OpenCode configuration

Edit the OpenCode configuration file at `~/.config/opencode/opencode.json`.

Add the tagged GitHub fork to the `plugin` array:

```json
{
  "plugin": [
    "git+https://github.com/YanzuoLu/opencode-claude-auth.git#v1.5.4-cc3"
  ]
}
```

This fork is GitHub-only (not published to npm). The release tag includes the
compiled `dist/` files so OpenCode can load `opencode-claude-auth.js` directly.

Or run this command to do it automatically:

```bash
node -e "
const fs = require('fs'), p = require('path').join(require('os').homedir(), '.config/opencode/opencode.json');
const c = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf8')) : {};
const spec = 'git+https://github.com/YanzuoLu/opencode-claude-auth.git#v1.5.4-cc3';
c.plugin = [...new Set([...(Array.isArray(c.plugin) ? c.plugin : [])
  .filter(x => x !== 'opencode-claude-auth' && x !== 'opencode-claude-auth@latest'), spec])];
fs.mkdirSync(require('path').dirname(p), {recursive:true});
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log('Added', spec, 'to', p);
"
```

No manual `npm install` is needed — OpenCode [automatically installs plugins
using Bun at startup](https://opencode.ai/docs/plugins/#how-plugins-are-installed).
Because this is pinned to a Git tag, upgrade by changing the tag in the plugin
spec and clearing the matching OpenCode package cache entry.

If your OpenCode build refuses git package specs, use the local file fallback
after cloning and building this repository:

```json
{
  "plugin": ["/path/to/opencode-claude-auth/opencode-claude-auth.js"]
}
```

### Step 2: Verification

Verify the plugin was added:

```bash
cat ~/.config/opencode/opencode.json
```

You should see the `git+https://github.com/YanzuoLu/opencode-claude-auth.git#v1.5.4-cc3`
spec in the `plugin` array.

## Upgrading

If you previously installed the npm `opencode-claude-auth@latest`, replace it
with the GitHub tag spec shown above.

If the plugin isn't picking up a new version, clear the cached package and restart OpenCode:

```bash
rm -rf ~/.cache/opencode/packages/opencode-claude-auth@latest/
rm -rf ~/.cache/opencode/packages/*opencode-claude-auth*
```

## Done

The plugin is now installed and configured. When you run OpenCode, it will automatically use your Claude Code credentials — no separate login needed.

## Troubleshooting

If you encounter issues, see the [main README troubleshooting section](README.md#troubleshooting).
