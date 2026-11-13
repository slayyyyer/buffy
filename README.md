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

Buffy is at **v3.3.3**. The 2.0 line rebuilt the companion around an
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
- [x] a cloud turn surfaced as one inferred state instead of looking like idle
- [x] a zero-config Claude transcript fallback that yields to installed hooks
- [x] a 90-second liveness clock that marks a silent session quiet without deleting it
- [x] pose hysteresis so a tool boundary cannot strobe the art
- [x] readiness reported per adapter in `/health`, `/state`, and `buffy status`

### 3.3.3

- **A cloud turn stops looking like an idle one.** A Freebuff thread whose
  `execution_target` is `cloud` writes no `turn_state` and no messages on this
  machine, so the database reader could only stay silent while an agent worked
  somewhere else. Buffy now reports one coarse state — **cloud turn, out of
  view** — labeled inferred and repeated at most every fifteen seconds while
  the thread keeps moving. It is a heartbeat, not a claim: no tool, no file, no
  completion, and never a passing test. A database without that column, or the
  source switched off in **Settings → Connection**, behaves exactly as before.
- **Every companion reacts, not just Buffy.** The five reactions had hand-drawn
  art on Buffy only, and the other twenty-one friends collapsed them to `idle`,
  `sleepy`, or `happy` before anything was drawn — so an error and a waiting
  turn looked identical. The atlas cast still borrows its nearest drawn body
  cell, but motion, face, and effects now keep the real reaction: a sweat drop,
  a tapping hand, a context squeeze, a waiting clock, and confetti, over every
  companion.
- **Dictation is gone instead of permanently unavailable.** The toolbar button
  was always hidden and Settings could only ever say it could not run, so both
  are removed along with the copy that promised a feature this build never had.
  Typing, the clipboard fallback, and the composer are unchanged, and update
  prompts now defer for a draft or a handoff only.
- **The installer block stops pointing backwards.** Every download link still
  named 3.2.0, two releases behind, and now follows this build instead.

### 3.3.2

- **The welcome screen names the running build.** The eyebrow hardcoded
  "Buffy 2.0"; the main process now passes the version in the window's load
  query, so it is right on first paint and cannot drift from the app.

### 3.3.1

- **A one-command check for a real turn.** `scripts/watch-freebuff-turn.js`
  watches `/state` and reports the first session from Freebuff's own database,
  so a live turn does not need manual polling.
- **Honest scope for the database reader.** The Freebuff section now records
  that threads with `execution_target` `cloud` never write `turn_state` or
  `messages`, so only a local-target turn can be seen.

### 3.3.0

- **Freebuff's own turn record.** Buffy now reads Freebuff Desktop's
  `desktop-v2.db` for each project, read-only, and maps the recorded turn onto
  her states: reasoning, reading, searching, editing, running a command,
  compacting, delegating, a failed tool, and a finished turn. The `AGENTS.md`
  checkpoints are still the explicit source — while one of those events is
  fresh, the database stays quiet and the two share one session instead of
  showing two. Nothing is written to the database and nothing leaves the
  machine. Between turns it only stats each project's database and WAL: an
  unchanged tick opens no database at all, and while nothing is running it backs
  off to `idlePollMs`. A live turn keeps the normal cadence so its heartbeat is
  still checked. **Settings → Connection → Local session evidence** has a switch
  for this source, the Claude transcript source, and the watcher, and the daemon
  card reports what each one last found. A `false` in `config.json` wins over
  all of those switches and locks them.
- **A Claude fallback that needs no setup.** If the Claude hook is missing, was
  removed by an update, or points at a moved install, Buffy tails the newest
  `~/.claude/projects/*/*.jsonl` transcript instead. A tool call with no result
  is working, a finished turn is done, and a call that never returns is
  abandoned after ten minutes. It reports itself as inferred, shares the hook's
  session id, and stays silent whenever the hook is still delivering.
- **Quiet, not gone.** A session with no new event for 90 seconds is marked
  `quiet`. Buffy keeps it in the list and stops presenting it as live work, so
  a five-minute build is not mistaken for a dead agent — and a dead adapter is
  not mistaken for a five-minute build. An unanswered permission request is
  never quiet.
- **No more strobing.** A pose must persist for 250ms and the current pose is
  held for at least 380ms, so a `PreToolUse`/`PostToolUse` pair no longer makes
  her flicker between reading and typing. A calmer pose also cannot interrupt a
  louder one, so a finished tool never wipes a celebration. Her typing hands
  still alternate.
- **Honest about what it can see.** A transcript that goes silent is never
  turned into a question, and neither adapter can celebrate a pass. Only an
  explicit zero exit code still does that.

### 3.2.0

- **The full companion roster.** Fairy, Retro robot, Knight, Fox wizard,
  Little ghost, Red panda, Axolotl, Clockwork inventor, Tiny witch, Star keeper,
  Little vampire, Cloud shepherd, Moon bunny, Wise owl, Tiny pirate captain,
  Ribbon dancer, Sun prince, and Dapper gent join Buffy, Mochi, Pip, and
  Mallow. Each new friend is a 3×3 atlas with all nine shared poses, a
  signature baked-in look, and their own picker portrait.
- **Buffy's dress collection.** Ten new dresses and a pleated Tulip skirt join
  her wardrobe, from Pink princess and Blue princess to Ballet tutu, Moonlit
  tulle, and Cherry sundress. Buffy now has 19 outfits, all pose-aligned across
  her layered art.
- **Portraits keep their shape.** The companion picker and compact overlay now
  size atlas art from the compact crop instead of the full cell, so no
  companion gets stretched horizontally. The picker also shows all 22
  companions with readable names and taglines.

### 3.1.0

- **Two more companions.** Pip is a peach comet fox with a star-tipped tail;
  Mallow is a mint marshmallow bear with a sleepy streak. Both join Buffy and
  Mochi in the picker and support the same nine shared poses. Their extra
  reactions map to the closest hand-drawn mood.
- **A portrait picker.** **Settings → Companion & wardrobe** now shows a live
  portrait card above each companion's name and tagline. The cards are drawn by
  the same character engine as the overlay, not stored screenshots.
- **Wardrobes for the atlas companions.** Pip and Mallow each have two outfits
  and four accessory variants, plus signature built-in looks. Their overlays
  stay aligned across all nine poses and sit above the typing, reading, tea,
  and gardening props.
- **Settings, plain and simple.** The tray and right-click menu item is now
  simply **Settings…**.

### 3.0.0

- **Companion language, everywhere.** The interaction is now `buffy hello`
  (the toolbar says **Say hi to Buffy**). `buffy pet`, `POST /pet`, and the old
  `pet` aliases are gone. `state.json` and `buffy status --json` use
  `companion`; old `pet` keys are not read, so existing state files start fresh.
- **Three more outfits and a warmer hello.** Buffy now has a cloud hoodie, a
  berry pinafore, and starry pajamas. Clicking her plays a short three-beat
  reaction — surprised, heart-eyed, then a soft settle — with a little squash
  and a bow that follows through. Her face screen is larger at every size.
- **Gemini CLI and Cursor connections.** **Settings → Connection** can now
  install, repair, check, and remove hooks for Gemini CLI and Cursor alongside
  Claude Code. Both adapters preserve unrelated settings and hook groups, use
  stable packaged launchers, and keep their own last-event health. Gemini
  returns an empty JSON object on stdout so its strict parser never sees a
  blocking hook; Cursor intentionally does not install `preToolUse`, so Buffy
  never approves or blocks a tool call.
- **Opt-in permission decisions.** Claude Code permission requests can now show
  **Allow once** and **Deny** in the activity card. It is off by default, scoped
  to one live `PermissionRequest`, and never enabled for Gemini or Cursor.

### 2.2.0

- **She has more feelings.** Five new layered reactions: `flustered` when a
  tool reports an error, `tapping` while she needs you, `squish` while the
  context is compacting, `waiting` after a minute of unbroken work, and
  `celebrate` for a verified pass. The atlas companions' nine-cell art maps
  each reaction to its closest hand-drawn mood.
- **Celebration stays honest.** File churn never celebrates. Send it explicitly
  with `buffy celebrate "tests passed"`, or let the Claude hook forward a test
  or build command whose `tool_response` carries an explicit zero exit code.
  The watcher remains inference-only.
- **Jump to the work.** Activity cards now carry the project folder a session
  reported. **Show project** opens it in your file manager; if the folder is
  missing, Buffy copies the session id so it can still be traced with
  `buffy status`.
- **A sound that fits.** Alerts can use a soft two-note chime or the system
  beep, with a volume slider and a **Test sound** button in **Settings →
  Alerts**.
- **She remembers where she sits.** “Move to corner” now checks the active
  corner and remembers it per display, so a second monitor lands where you
  left it.
- **Compact mode reads better.** The current message replaces the state label in
  the pill, the phantom “0” badge is gone, and the full toolbar stays reachable.

### 2.1.1

- **Compact mode fits its window again.** The compact toolbar kept its fixed
size while the window shrank, so choosing Small cut off its right end. The whole
overlay now scales with the chosen size, and the unavailable dictation slot no
longer renders and pads out the toolbar.
- **The update prompt stops coming back.** Buffy only offers a build that is
newer than the one running, remembers a version you put off with **Later** so it
does not ask on every launch, and relaunches after installing so the new version
is the one you actually see.

### 2.1.0

- **She comes in more sizes.** The old 80/100/125% steps are now Small,
Medium, Large, Extra large (150%), and Huge (175%). Choose one in
**Settings → Companion & wardrobe → Size**, or from the new **Size** submenu on
the right-click and tray menus.
- **Small now shrinks the whole window.** The 80% step only applied to compact
mode before, so picking Small left the full window unchanged. Every mode scales
with the chosen size now.
- **A size that does not fit is refused.** Instead of letting her hang off the
screen, Buffy rejects a size whose resting window is larger than the display and
leaves the choices that do fit enabled. The composer and activity panels are
clamped to the work area so a large size cannot lock you out of them.

### 2.0.2

- **She answers to Buffy, only.** The character was still called Nimbus in the
manifest, the built-in looks, the settings defaults and the docs. The character
id, asset folder and preferences key are now `buffy`, and saved wardrobes,
favorite looks, and rotation settings carry over from the old key on first load.
- **A new icon.** The app, tray, and site icons are rendered from her current
layered art instead of the pre-2.0 pink cloud with the crown.

### 2.0.1

- **Dragging no longer makes her grow.** The overlay captures its size once when
a drag starts instead of re-applying bounds on every pointer event, which
Windows was rounding up at display scales above 100%.
- **The status pill sits above her head.** While idle, the overlay measures the
topmost drawn pixel of the current character and art and hangs the pill 8px
above it, so hats, bows, and custom sprites no longer collide with it.

## Requirements

- Node.js 20+ to run from source or use the CLI
- Windows, macOS or Linux with a desktop session (the overlay is Electron)
- Git is recommended for the Freebuff watcher

## Install and run

### Desktop installer

Buffy **3.3.3** ships for Windows, macOS, and Linux:

- **Windows 10/11 (x64):** [installer](https://github.com/slayyyyer/buffy/releases/download/v3.3.3/Buffy-3.3.3-win-x64.exe) · [SHA-256](https://github.com/slayyyyer/buffy/releases/download/v3.3.3/Buffy-3.3.3-win-x64.exe.sha256)
- **macOS Apple silicon:** [dmg](https://github.com/slayyyyer/buffy/releases/download/v3.3.3/Buffy-3.3.3-mac-arm64.dmg) · [SHA-256](https://github.com/slayyyyer/buffy/releases/download/v3.3.3/Buffy-3.3.3-mac-arm64.dmg.sha256)
- **macOS Intel:** [dmg](https://github.com/slayyyyer/buffy/releases/download/v3.3.3/Buffy-3.3.3-mac-x64.dmg) · [SHA-256](https://github.com/slayyyyer/buffy/releases/download/v3.3.3/Buffy-3.3.3-mac-x64.dmg.sha256)
- **Linux x64:** [AppImage](https://github.com/slayyyyer/buffy/releases/download/v3.3.3/Buffy-3.3.3-linux-x86_64.AppImage) · [SHA-256](https://github.com/slayyyyer/buffy/releases/download/v3.3.3/Buffy-3.3.3-linux-x86_64.AppImage.sha256)

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
5. **Connection** — Claude, Gemini CLI, and Cursor hook health, Claude permission decisions, Freebuff watcher, daemon status
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

The database signal reports a locally executed turn in detail. Threads whose
`execution_target` is `cloud` never write `turn_state` or `messages`, so nothing
local can say what one is doing. While such a thread is being updated Buffy
shows a single coarse, explicitly inferred state — `cloud turn, out of view` —
instead of looking idle while work happens elsewhere. She never claims to know
what a cloud turn is doing.

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
- A cloud Freebuff turn is reported as one inferred state; Buffy never fills it
  in with local-looking progress.

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
