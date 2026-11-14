# buffy

A tiny always-on-top companion for Claude Code, Gemini CLI, Cursor, Freebuff,
and any coding agent that can run a shell command. Buffy watches the work,
keeps her own little life, and can carry a prompt into Claude without sending
it for you.

<p align="center">
  <img src="docs/shots/buffy.png" width="260" alt="Buffy, a plush storm-cloud companion in a lavender cloud hoodie with heart eyes">
</p>

<p align="center">
  <a href="https://slayyyyer.github.io/buffy/"><strong>Website</strong></a> ·
  <a href="https://github.com/slayyyyer/buffy/releases/latest">Windows installer</a> ·
  <a href="https://github.com/slayyyyer/buffy#readme">Source</a>
</p>

```
Claude Code ──hooks──────────┐
Gemini CLI ──hooks───────────┤
Cursor ──hooks──────────────┤
Freebuff ──AGENTS.md─────────┤
repo edits ──watcher─────────┼──► HTTP + SSE 127.0.0.1:4517 ──► daemon ──► ~/.buffy/state.json
a script ──buffy─────────────┘                                      │
                                                                    └──► Electron overlay + settings
```

Buffy is not a chatbot. Agents send events; the daemon owns the state and the
overlay draws it. Claude, Gemini CLI, and Cursor hooks are explicit. The
Freebuff watcher is inferred and labeled as such.

## Status

Buffy is at **v3.3.4**. The 2.0 line rebuilt the companion around an
asset-driven character system and a request-aware session model; 2.1 added a
real size control and kept compact mode inside its window; 2.2 added reactions,
project jumps, sound choices, and per-display corners. 3.0 made the interaction
and stored identity companion-first, added three outfits, and gave her a larger
face and a three-beat hello. 3.1 introduced Pip and Mallow, a portrait-based
picker, and pose-aligned wardrobes for both new companions. 3.2 expands the cast
to twenty-two companions, adds Buffy's dress collection, and keeps every
portrait in proportion. 3.3 reads two more local sources and stops a silent
session from looking like live work:

- [x] Buffy's layered artwork and the 21 atlas companions, rendered by one engine
- [x] twenty-two companions with live portrait cards and per-character looks
- [x] Buffy's wardrobe of 19 outfits, including ten dresses and a pleated skirt
- [x] poses: idle, typing left/right, happy, wave, sleepy, reading, tea, gardening
- [x] reactions: flustered, tapping, squish, waiting, and an explicit-only celebrate
- [x] full composer for Claude with draft-safe `claude://` handoff
- [x] request-aware concurrent sessions with pending badges that only count requests
- [x] three lifecycles: 30s completion presentation, 5m recent completions, 30m stale sessions
- [x] six-section settings window with live preview, wardrobe, alerts, connection, updates
- [x] wardrobe layers for Buffy, Pip, and Mallow, independent clothing switches, favorites, 32 saved looks
- [x] opt-in daily rotation that starts the next local day and skips unavailable art
- [x] default-off request/completion notifications, sounds, and 15m/1h/4h snooze
- [x] packaged Claude hook installer with a stable launcher and health distinctions
- [x] draft-aware update guard and explicit deferred-update resume
- [x] reaction effects for every companion, not only for Buffy
- [x] Freebuff's own session database read read-only, so a running turn is explicit
- [x] a zero-config Claude transcript fallback that yields to installed hooks
- [x] a 90-second liveness clock that marks a silent session quiet without deleting it
- [x] pose hysteresis so a tool boundary cannot strobe the art
- [x] readiness reported per adapter in `/health`, `/state`, and `buffy status`

Every release from 2.0.1 through 3.3.4 is written up in
[CHANGELOG.md](CHANGELOG.md).

## Requirements

- Node.js 20+ to run from source or use the CLI
- Windows, macOS or Linux with a desktop session (the overlay is Electron)
- Git is recommended for the Freebuff watcher

## Install and run

Buffy ships unsigned, so Windows and macOS both warn once. On macOS the terminal
is the better path: one command, and Homebrew keeps upgrades in the same place.
On Windows the release installer is the install path, because Buffy is not in a
package manager there.

### macOS: Homebrew tap

```bash
brew tap slayyyyer/buffy https://github.com/slayyyyer/buffy
brew trust slayyyyer/buffy
brew install --cask buffy
```

Homebrew refuses to load casks from an untrusted third-party tap, so `brew trust`
is required between the tap and the install. It approves this one tap, not every
tap, and the install fails without it.

`homebrew/cask` requires Gatekeeper to pass, which an unsigned build cannot, so
Buffy keeps its own tap (`Casks/buffy.rb` in this repository). The cask declares
`auto_updates true`: Buffy updates herself through `electron-updater`, so
Homebrew handles the first install and leaves later versions to the app.
Homebrew still quarantines the download, so approve Buffy once in **System
Settings → Privacy & Security → Open Anyway**.

### Direct installers

Buffy **3.3.4** ships for Windows, macOS, and Linux:

- **Windows 10/11 (x64):** [installer](https://github.com/slayyyyer/buffy/releases/download/v3.3.4/Buffy-3.3.4-win-x64.exe) · [SHA-256](https://github.com/slayyyyer/buffy/releases/download/v3.3.4/Buffy-3.3.4-win-x64.exe.sha256)
- **macOS Apple silicon:** [dmg](https://github.com/slayyyyer/buffy/releases/download/v3.3.4/Buffy-3.3.4-mac-arm64.dmg) · [SHA-256](https://github.com/slayyyyer/buffy/releases/download/v3.3.4/Buffy-3.3.4-mac-arm64.dmg.sha256)
- **macOS Intel:** [dmg](https://github.com/slayyyyer/buffy/releases/download/v3.3.4/Buffy-3.3.4-mac-x64.dmg) · [SHA-256](https://github.com/slayyyyer/buffy/releases/download/v3.3.4/Buffy-3.3.4-mac-x64.dmg.sha256)
- **Linux x64:** [AppImage](https://github.com/slayyyyer/buffy/releases/download/v3.3.4/Buffy-3.3.4-linux-x86_64.AppImage) · [SHA-256](https://github.com/slayyyyer/buffy/releases/download/v3.3.4/Buffy-3.3.4-linux-x86_64.AppImage.sha256)

The packaged app includes Buffy, the local daemon, and stable hook and CLI
launchers, so Claude Code does **not** need a Node checkout. Open **Settings →
Connection** to install or repair the hooks and the `/buffy` command. Only the
optional `buffy` terminal CLI runs from the source checkout.

Builds are unsigned unless signing credentials are configured, so Windows
SmartScreen and macOS Gatekeeper may ask you to confirm. See
[Release signing](#release-signing).

### From source

```bash
npm install          # installs Electron
npm link             # optional: put `buffy` on your PATH
buffy overlay        # starts the daemon on demand and shows Buffy
```

The overlay is frameless, transparent, and always on top. Drag the character
to move her, click her to say hi, right-click for the menu, and use the pill
toolbar for compose, activity, wardrobe, compact mode, and settings.

The first-run setup window explains the overlay, the global shortcut, the
Claude connection, and where state lives. Reopen it from the tray or with
`buffy overlay --onboarding`.

<p align="center">
  <img src="docs/shots/overlay.png" width="360" alt="Buffy's overlay showing a heart-eyed hello in starry pajamas with a That tickles! bubble and the toolbar">
</p>

## Compose for Claude

Buffy's composer is a draft tray, not a send button with a text field.

- The default global shortcut is **Ctrl/Cmd + Shift + B**. Change it in
  **Settings → Shortcuts**. If the accelerator is already taken, Buffy reports
  the conflict and keeps the previous shortcut; it never silently falls back.
- Summoning reveals the overlay, expands the composer, places it near the
  pointer when hidden, and focuses the existing draft without recording or
  sending anything.
- **Ctrl/Cmd + Enter** hands the draft to Claude. Buffy opens
  `claude://code/new?q=<encoded>` through the OS.
- Unicode, newlines, and literal `+` survive encoding.
- The handoff is deliberately capped at **4,000 encoded URL characters**. A
  longer draft is rejected with a copy fallback; it is never truncated.
- Buffy logs no prompt-bearing URL. A successful OS launch only proves the link
  was handed to the operating system; Claude still shows the prompt for review.
- Drafts live in the main process, not on disk. Hiding, compact mode, settings,
  failed opens, and window resizes preserve the draft. It clears only after a
  successful handoff if the revision has not changed in the meantime.
- **Escape** closes the panel and asks the OS to restore focus where supported.
- Update prompts never interrupt an open composer, a non-empty draft, or an
  in-flight handoff.

<p align="center">
  <img src="docs/shots/compose.png" width="360" alt="Buffy's composer with a draft prompt, a Hi pill, and the Open in Claude button">
</p>

## Characters, wardrobe, and poses

Buffy uses an asset-driven character system. A character is either layered
(base + outfit + accessory layers + semantic pose art) or an atlas with one
cell per pose. The overlay, wardrobe preview, and settings preview all use the
same renderer.

**Buffy** is the plush storm-cloud, drawn as layered SVG. **Mochi** is a
pocket bunny, **Pip** is a comet fox with a star-tipped tail, and **Mallow** is
a mint marshmallow bear. The 3.2 roster adds Fairy, Retro robot, Knight, Fox
wizard, Little ghost, Red panda, Axolotl, Clockwork inventor, Tiny witch, Star
keeper, Little vampire, Cloud shepherd, Moon bunny, Wise owl, Tiny pirate
captain, Ribbon dancer, Sun prince, and Dapper gent. Each new companion uses a
3×3 atlas and ships with a signature baked-in look. Pip and Mallow also ship
pose-aligned outfit and accessory overlays, with signature built-in looks; Pip
has the Comet capelet and Stargazer vest, while Mallow has the Marshmallow shrug
and Moonlight pinafore. Every companion supports:

`idle` · `typingLeft` · `typingRight` · `happy` · `wave` · `sleepy` · `reading` · `tea` · `gardening`

Buffy also reacts to the moment with five extra layered poses: `flustered`
when a tool reports an error, `tapping` while she needs you, `squish` while the
context is compacting, `waiting` after a minute of unbroken work, and
`celebrate` for a verified pass. Every companion shows them: where Buffy has
hand-drawn art, the atlas cast keeps its nearest nine-cell mood and the renderer
draws the same reaction effects over it — a sweat drop, a tapping hand, a
context squeeze, a waiting clock, and confetti.

A celebration is never inferred from file churn. Send it explicitly after a
pass you actually saw:

```sh
buffy celebrate "tests passed"
```

The Claude Code hook also forwards a celebration when a test or build command's
`tool_response` carries an explicit zero exit code. Without that code, the hook
stays quiet rather than guessing.

Open **Settings → Companion & wardrobe** to:

- choose a character and preview every pose
- change name and pronouns
- mix outfits, bows, hats, glasses, wands, and themes
- switch each clothing slot off without deleting the underlying look
- keep a signature look for the 18 new companions, whose outfits are baked in
- wear built-in looks or save your own (up to **32 per character**)
- favorite looks, rename/replace/delete saved looks, and choose which saved looks
  participate in rotation
- use **Surprise me**, with a gentle bias toward favorites

Clothing selections are stored per character. Unavailable art is disabled in
the choice list rather than silently deleting a saved selection.

<p align="center">
  <img src="docs/shots/settings.png" width="760" alt="Buffy settings showing the 22-companion roster with Fairy selected, the Size control set to Medium, the live character preview, and the wardrobe chips">
</p>

### Daily rotation

Rotation is opt-in per character and starts on the **next local day**, not the
day you enable it. It only runs while resting. An open composer, activity cards,
an open settings window, a handoff, or a drag defers the change. A manual look
change on a local day prevents a reroll that day, and a restart does not reroll
a day that already rotated. Unavailable assets are skipped without consuming
the day or deleting the look.

## Sessions and lifecycles

Every agent event belongs to a session. Claude hooks use the payload
`session_id`; the watcher has its own session; CLI callers can pass
`--session <id>` or set `BUFFY_SESSION`.

The visible state is the highest-priority active session:

`needs-you` > `error` > `working` > `thinking` > `done` > `idle`

Requests are tracked separately from session state:

- A permission request or question has a stable request id, or a stable
  fingerprint when the hook has no id.
- Unrelated parallel tool completions cannot clear a request.
- A matching request id, tool-use id, or safe fingerprint/tool-name match
  resolves it. Session end clears only that session's requests.
- An idle reminder is informational. It never dismisses a request or wipes a
  recent completion.
- The pending badge counts **unresolved requests only**, not "done" animations.

Activity cards carry the project folder a session reported. **Show project**
opens that folder in your file manager; if the session never reported one, or
the folder is gone, Buffy copies the session id instead so it can still be
traced with `buffy status`. Claude hooks supply the folder automatically, and
`buffy event --cwd <dir>` does it for CLI callers.

Three lifecycles are intentionally separate:

| Lifecycle | Default | What it means |
| --- | --- | --- |
| Completion presentation | 30 seconds | `done` hop/sparkles before Buffy returns to idle |
| Recent completions | 5 minutes | Activity cards can still show what finished |
| Stale session expiry | 30 minutes | Quiet sessions are removed |

These are configurable with `doneHoldMs` and `sessionTtlMs` in
`~/.buffy/config.json`.

## Personality and quiet time

**Settings → Personality** controls idle hobbies, extra gestures, return
greetings, sleepiness, thought bubbles (Off / Emoji / Emoji + words), reduced
motion, and reply reactions. Reply reactions are **off by default** and only use
transient presentation categories. Decorations pause while composing,
recording, or showing activity cards. Settings previews are visual only and do
not trigger live reactions.

## Alerts

Request and completion notifications are **off by default**, as are sounds.
Enable them in **Settings → Alerts**; sound alerts can be a soft two-note chime
with a volume slider or the system beep, and **Test sound** previews the choice.
The first snapshot after startup seeds the
dedupe set, so old requests never burst out on launch. A snooze (15 minutes,
1 hour, or 4 hours) suppresses delivery but still marks events seen; they are
never replayed later. Idle reminders do not create request alerts, and inferred
completion events never create completion notifications.

## Settings

The settings window has six sections:

1. **Companion & wardrobe** — identity, character, clothing, saved looks, rotation
2. **Personality** — hobbies, gestures, sleep, bubbles, motion, reactions
3. **Shortcuts** — global summon shortcut and conflict status
4. **Alerts** — request/completion/sound switches and snooze
5. **Connection** — Claude, Gemini CLI, and Cursor hook health with a **Send a test event** button per agent, Claude permission decisions, Freebuff watcher, daemon status
6. **Updates** — current version, update check, install guard

The right-hand preview draws the current character at full size with selectable
poses, so wardrobe changes are visible before you leave settings.

## Claude Code

Use **Settings → Connection → Connect Claude Code** in the packaged app. It
writes a stable launcher to `~/.buffy/bin/buffy-hook.cmd` (Windows) or
`~/.buffy/bin/buffy-hook` (macOS/Linux), then merges hooks into the **user**
Claude settings (`~/.claude/settings.json`). The launcher runs the packaged
Electron binary in Node mode and survives app updates. It also writes
`~/.buffy/bin/buffy-cli.cmd` / `buffy-cli` for the `/buffy` command, so the
slash command works without a checkout too.

From a source checkout, the equivalent is:

```bash
buffy install claude --global
# or project scope:
buffy install claude
```

The installer:

- preserves unrelated hooks and settings
- backs up every changed file as `<name>.buffy-backup-<timestamp>`
- writes atomically and restores the prior settings if the command file fails
- respects Claude's `disableAllHooks` and refuses to claim a connection when
  hooks are disabled
- records the install in `~/.buffy/installs.json`
- observes without blocking by default: every hook exits 0 and writes
  diagnostics only to stderr. The opt-in decision path waits for at most eight
  seconds, then falls through to Claude's normal prompt.

The installed hook vocabulary:

| Claude Code event | Buffy behavior |
| --- | --- |
| `SessionStart` | session visibility |
| `UserPromptSubmit` | thinking |
| `PreToolUse` | working, with a tool category |
| `PermissionRequest` | explicit permission request; optional Allow/Deny from Buffy while the hook is live |
| `PostToolUse` | working; resolves matching requests |
| `PostToolUseFailure` | error |
| `Notification` | question/permission request, or informational idle reminder |
| `PreCompact` / `PostCompact` | compacting |
| `SubagentStop` | delegating finished |
| `Stop` | explicit completion |
| `SessionEnd` | session ended; clears its requests |

The settings page distinguishes **not connected**, **installed but no event
seen**, **repair needed**, **hooks disabled**, **connected** (a hook event was
seen within 30 minutes), and **error**. Installation alone is not reported as a
verified connection.

### Permission decisions from Buffy

**Off by default.** Enable **Settings → Connection → Permission decisions from
Buffy**. While Claude's `PermissionRequest` hook is waiting, the activity card
shows **Allow once** and **Deny** for that one request. Buffy holds Claude's own
prompt for up to eight seconds; if nobody answers, the hook exits without a
decision and Claude's normal prompt appears. If the overlay is not connected,
Buffy does not wait at all.

The response is limited to Claude Code. Gemini permission notifications and
Cursor hooks stay view-only because neither exposes a safe response channel.
The daemon requires a local control token for decisions, rejects browser
`Origin` requests, and removes the action as soon as the hook times out or the
request is resolved. The token is written to `~/.buffy/runtime.json`; it is not
an OS-level boundary against other software running as your user, so enable this
only on a machine you trust.

## Gemini CLI

Use **Settings → Connection → Connect Gemini CLI**. The packaged app writes a
stable launcher to `~/.buffy/bin/` and merges hook groups into the **user-level**
Gemini settings (`~/.gemini/settings.json`). Existing settings and hook groups
are preserved, unrelated hooks keep running, and `hooksConfig.enabled: false`
is respected rather than overridden. From a source checkout, use
`buffy install gemini --global`; without `--global` it writes project settings
in `.gemini/settings.json`.

| Gemini CLI event | Buffy behavior |
| --- | --- |
| `SessionStart` | session visibility |
| `BeforeAgent` | thinking |
| `BeforeTool` | working, with the Gemini tool category |
| `AfterTool` | working; errors become the error state, and a matching tool resolves a permission request |
| `AfterAgent` | explicit completion |
| `Notification` | `ToolPermission` becomes an explicit request; other notices stay quiet |
| `PreCompress` | compacting |
| `SessionEnd` | session ended; clears its requests |

Gemini treats stdout as strict JSON. Every Buffy Gemini hook exits 0 and writes
`{}`; diagnostics go only to stderr. A permission notification can tell you
that Gemini is waiting, but it cannot grant the permission for you — approve it
in Gemini itself.

## Cursor

Use **Settings → Connection → Connect Cursor**. The packaged app merges hooks
into the **user-level** `~/.cursor/hooks.json`; from a checkout use
`buffy install cursor --global`, or omit `--global` for a project-level
`.cursor/hooks.json`. Existing hooks and the schema version are preserved.

| Cursor event | Buffy behavior |
| --- | --- |
| `sessionStart` / `sessionEnd` | session visibility and request cleanup |
| `beforeSubmitPrompt` | thinking |
| `postToolUse` | working, with the tool category |
| `postToolUseFailure` | explicit error |
| `afterFileEdit` | editing |
| `afterShellExecution` | running |
| `preCompact` | compacting |
| `subagentStop` | delegating finished, or error |
| `stop` | completion (or an error state when Cursor reports one) |

Buffy deliberately **does not install Cursor's `preToolUse` permission hook**.
That hook can approve or deny tool calls, and a status companion must not make
those decisions. Cursor's `beforeSubmitPrompt` receives `{"continue":true}` and
the other hooks receive `{}`, so they observe without changing the action.
Cursor reloads `hooks.json` when it changes; restart Cursor if it was already
open and does not pick up the hooks.

## Freebuff

Freebuff has no user-installable lifecycle hook stream. Buffy uses two signals:

- **Repo watcher (dependable):** file churn sends `working`; a quiet window
  sends `done` with category `settled-inferred` and message `activity settled`.
  It never claims a test passed or that work succeeded.
- **AGENTS.md instructions (best-effort):** `buffy install freebuff` appends a
  marked block asking the agent to send thinking/working/needs-you/done events.
  Agents can ignore it.

The database signal reports a locally executed turn in detail. Freebuff writes no
local turn state for a turn that runs somewhere else, so Buffy stays silent about
one rather than guessing: no invented tool, file, or completion. A thread that
belongs to a Cloud account but runs here is read in full like any other.

The watcher is local (`fs.watch` + a periodic `git status`) and does not read
file contents or upload anything. **Settings → Connection** can disable it; the
daemon restarts to apply the change.

## CLI

| Command | Purpose |
| --- | --- |
| `buffy daemon` | Run the local daemon in the foreground |
| `buffy event <state> [--msg "text"] [--source name] [--session id] [--cwd dir]` | Send a state change |
| `buffy hello` | Say hi, mood, and XP |
| `buffy celebrate [message]` | Explicit celebration for a verified test or build pass |
| `buffy dismiss <session>` | Clear one active session |
| `buffy status [--json]` | Current state, sessions, mood, XP, daemon health |
| `buffy overlay [--dev] [--onboarding] [--shot file.png]` | Show the overlay and optional setup |
| `buffy hatch "<prompt>"` | Generate a custom sprite with OpenAI Images |
| `buffy install claude [--global]` | Merge Claude hooks and `/buffy` |
| `buffy install gemini [--global]` | Merge Gemini CLI lifecycle hooks |
| `buffy install cursor [--global]` | Merge Cursor observational hooks |
| `buffy uninstall claude [--global]` | Remove Buffy-managed hooks only |
| `buffy uninstall gemini [--global]` | Remove only Buffy's Gemini hooks |
| `buffy uninstall cursor [--global]` | Remove only Buffy's Cursor hooks |
| `buffy install freebuff` | Add best-effort AGENTS.md instructions |
| `buffy uninstall freebuff` | Remove only the Buffy block |

States accepted by `buffy event`: `idle`, `thinking`, `working`, `needs-you`,
`done`, `error`.

## Files

| Path | Contents |
| --- | --- |
| `~/.buffy/preferences.json` | v3 identity, character looks, personality, shortcuts, alerts, connection, updates |
| `~/.buffy/state.json` | companion identity, sprite, mood, XP, counters |
| `~/.buffy/window.json` | full/compact positions, size (80–175% scale), and the remembered corner per display |
| `~/.buffy/config.json` | port, timing, watcher, hatch settings |
| `~/.buffy/runtime.json` | daemon pid/port while running |
| `~/.buffy/onboarding.json` | first-run acknowledgement |
| `~/.buffy/installs.json` | installer manifest (scope, files, launcher, backups) |
| `~/.buffy/hook-last-<agent>.json` | last hook event seen per agent (health only) |
| `~/.buffy/hook-last.json` | legacy Claude health record (still written for compatibility) |
| `~/.buffy/bin/` | stable packaged hook launcher |
| `~/.buffy/sprites/` | generated hatch PNGs |

Legacy `~/.buffy/wardrobe.json` and `config.overlay` settings migrate into
`preferences.json`. Old `princess`/`sleepover` outfit ids map to `dress` and
`overalls`. Nothing is deleted.

## Configuration

`~/.buffy/config.json` is optional; defaults include:

```json
{
  "port": 4517,
  "doneHoldMs": 30000,
  "sessionTtlMs": 1800000,
  "livenessMs": 90000,
  "freebuff": {
    "enabled": true,
    "pollMs": 1000,
    "idlePollMs": 5000,
    "staleMs": 120000,
    "maxProjects": 4,
    "explicitGraceMs": 120000
  },
  "claudeTranscript": {
    "enabled": true,
    "pollMs": 1500,
    "activeMs": 900000,
    "stuckMs": 600000,
    "doneWindowMs": 60000,
    "explicitGraceMs": 120000
  },
  "watch": {
    "enabled": true,
    "directory": null,
    "quietMs": 2500,
    "pollMs": 700
  },
  "hatch": {
    "provider": "openai",
    "model": "gpt-image-1",
    "size": "1024x1024",
    "quality": "medium",
    "baseUrl": "https://api.openai.com/v1"
  }
}
```

`BUFFY_PORT` overrides the port for one process. `BUFFY_HOME` relocates all
state (used by tests). `BUFFY_FREEBUFF_HOME` and `CLAUDE_CONFIG_DIR` relocate
the two databases and transcripts those adapters read. Preferences are edited
through the settings window; the main process normalizes them before every
save.

A source switched off in this file — `watch.enabled`, `freebuff.enabled`, or
`claudeTranscript.enabled` — stays off: **Settings → Connection** shows that
switch locked and says why, and the app will not turn it back on. Otherwise the
Settings toggle decides, and `enabled: true` (or no `enabled` line at all) is
only a default. That order is deliberate: a hand-edited file is a statement the
app must not silently undo, while a toggle is meant to be reversible.

`livenessMs` is how long a session may go without an event before it is shown
as quiet; it is independent of `sessionTtlMs`, which is when the session is
finally dropped.

`node scripts/verify-config-precedence.js` checks that order end to end: it
starts the app against a temporary home whose `config.json` and preferences
disagree, asserts the daemon health and the locked Connection switch, then flips
the watcher and the Claude transcript switch and confirms each toast and a real
daemon restart that keeps honouring the file. It also clicks the locked switch
to prove it cannot be turned on. It opens a window briefly, so it is not part of
`npm test`.

`node scripts/watch-freebuff-turn.js` waits on the database path instead: it
polls `/state` and stops on the first session from Freebuff's own database
(`source: freebuff-db`), so a live local turn is one command rather than manual
polling. `--port` picks an instance, `--timeout` bounds the wait, `--json`
prints a single object, and it exits 2 if no turn arrives.

## Hatching a sprite

`buffy hatch` generates a transparent PNG with OpenAI Images, stores it in
`~/.buffy/sprites/`, and swaps it into the running companion. The overlay keeps its
bob and state effects; the generated art replaces the layered body. A custom
sprite is a full-body replacement, so procedural outfits, accessories, and
hobby props are not drawn over it. Set `OPENAI_API_KEY` in the shell that runs
the command; the key is never written to Buffy state or logged.

## Security and privacy

- The daemon binds to `127.0.0.1` only and streams updates over SSE with a
  polling fallback.
- The overlay is excluded from screen capture where the OS supports it, and on
  macOS it stays out of other apps' fullscreen spaces, so she cannot appear in a
  screen share or float over a call.
- No telemetry.
- Installed builds check GitHub Releases for updates. The only other outbound
  request is `buffy hatch`, which sends the prompt to the configured image API
  using your `OPENAI_API_KEY`.
- The watcher is local and never reads file contents.
- The Freebuff and Claude adapters open their local files read-only, inside the
  same machine, and never write to them. Both can be switched off in
  **Settings → Connection → Local session evidence** or in `~/.buffy/config.json`,
  where an explicit `false` is final. Neither can send a prompt, answer a
  permission request, or report a passing test.
- The composer deliberately cannot send a prompt. It hands a URL to the OS and
  clears the draft only after a successful launch with no intervening edit.
- Buffy never installs Cursor's `preToolUse` permission hook, so the companion
  cannot approve or deny a Cursor tool call.
- Claude permission decisions are opt-in, scoped to one live request, and require
  the daemon's local control token. The token is a same-user file, not a sandbox
  against malicious local processes.
- Prompt-bearing URLs are never written to logs.
- The Freebuff reader reports only the turn Freebuff recorded; it never fills in
  progress for a turn it cannot see.

## Troubleshooting

- **Buffy does not appear.** Run `buffy status`; if the daemon is offline, run
  `buffy daemon` in a terminal to see the error. Electron must be installed
  (`npm install`).
- **Port already in use.** Change `port` in `~/.buffy/config.json`.
- **Shortcut does nothing.** Open **Settings → Shortcuts**. A conflict with
  another app is reported there; choose a different accelerator.
- **Claude connection says installed but no event.** Start a Claude Code
  session. "Connected" requires an event within the last 30 minutes.
- **Hooks are disabled.** Claude's `disableAllHooks` is on. Buffy leaves the
  settings untouched and reports the disabled state.
- **Allow once / Deny is missing.** Enable **Settings → Connection → Permission
  decisions from Buffy**. It only appears while Claude's hook is waiting (up to
  eight seconds) and the overlay is connected; otherwise Claude prompts normally.
- **Watcher does not react.** Check **Settings → Connection**. Changing the
  watch switch restarts the daemon for you; the watched directory itself is the
  daemon's working directory, so start it from the project root.
- **Update is waiting.** Finish or clear the draft, then use the tray or
  **Settings → Updates** to restart explicitly. Buffy does not install updates
  behind an open draft.

## Release signing

The release workflow builds unsigned artifacts when optional secrets are
absent. To enable signing and notarization:

| Platform | Secrets |
| --- | --- |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |
| macOS | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |

Until those credentials exist, the macOS instructions lead with the Homebrew tap
(`Casks/buffy.rb`) because it keeps upgrades in one place — not because it avoids
the warning. Homebrew does not suppress Gatekeeper, and Windows SmartScreen still
warns once for the direct installer.

macOS runs `build/notarize.cjs` after signing and skips notarization when the
Apple credentials are missing. Pushing a `v*` tag that matches `package.json`
builds the installers, smoke-tests each packaged app, writes checksums, and
uploads the `latest*.yml` update metadata. Build locally with:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

## Verification

```bash
npm test                 # unit and integration coverage
npm start                # run the overlay from source
npx electron . --smoke-test --no-sandbox
npx electron . --shot docs/shots/overlay.png --shot-mode hello --shot-exit
npx electron . --shot docs/shots/settings.png --shot-mode settings --shot-exit
```

## Uninstall

Use **Settings → Connection → Remove hooks** or:

```bash
buffy uninstall claude --global
buffy uninstall freebuff
```

Turn off launch at login, quit Buffy from the tray, then remove `~/.buffy` and
the checkout (and `npm unlink buffy` if linked).

## License

MIT. The Blossom/Ensemble relay, inbox, badges, reactions, and mode features are
intentionally not part of Buffy; this is a local desktop companion.
