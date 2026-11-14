# Changelog

Release notes for every Buffy version, newest first. The current feature list,
install steps, adapter setup and configuration live in [README.md](README.md).

## 3.3.4

- **The cloud-turn state is gone.** 3.3.3 added a coarse "cloud turn, out of
  view" state for threads whose Freebuff record looked cloud-executed. A real
  `desktop-v2.db` showed the rule read the wrong column: 67 of 80 threads carry
  `execution_target = 'cloud'` just for belonging to a Cloud account, while
  every recorded turn ran locally, so the state would have announced itself over
  ordinary sessions. Watching that database through a full turn recorded no
  cloud execution at all, so the branch could never fire honestly. It is removed
  along with its settings copy and documentation.

## 3.3.3

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

## 3.3.2

- **The welcome screen names the running build.** The eyebrow hardcoded
  "Buffy 2.0"; the main process now passes the version in the window's load
  query, so it is right on first paint and cannot drift from the app.

## 3.3.1

- **A one-command check for a real turn.** `scripts/watch-freebuff-turn.js`
  watches `/state` and reports the first session from Freebuff's own database,
  so a live turn does not need manual polling.
- **Honest scope for the database reader.** The Freebuff section now records
  that threads with `execution_target` `cloud` never write `turn_state` or
  `messages`, so only a local-target turn can be seen.

## 3.3.0

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

## 3.2.0

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

## 3.1.0

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

## 3.0.0

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

## 2.2.0

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

## 2.1.1

- **Compact mode fits its window again.** The compact toolbar kept its fixed
size while the window shrank, so choosing Small cut off its right end. The whole
overlay now scales with the chosen size, and the unavailable dictation slot no
longer renders and pads out the toolbar.
- **The update prompt stops coming back.** Buffy only offers a build that is
newer than the one running, remembers a version you put off with **Later** so it
does not ask on every launch, and relaunches after installing so the new version
is the one you actually see.

## 2.1.0

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

## 2.0.2

- **She answers to Buffy, only.** The character was still called Nimbus in the
manifest, the built-in looks, the settings defaults and the docs. The character
id, asset folder and preferences key are now `buffy`, and saved wardrobes,
favorite looks, and rotation settings carry over from the old key on first load.
- **A new icon.** The app, tray, and site icons are rendered from her current
layered art instead of the pre-2.0 pink cloud with the crown.

## 2.0.1

- **Dragging no longer makes her grow.** The overlay captures its size once when
a drag starts instead of re-applying bounds on every pointer event, which
Windows was rounding up at display scales above 100%.
- **The status pill sits above her head.** While idle, the overlay measures the
topmost drawn pixel of the current character and art and hangs the pill 8px
above it, so hats, bows, and custom sprites no longer collide with it.
