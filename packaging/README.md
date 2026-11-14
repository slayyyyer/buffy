# Terminal install: Homebrew tap

`Casks/buffy.rb` turns this repository into its own tap, so macOS users get a
terminal install path with working upgrades:

```bash
brew tap slayyyyer/buffy https://github.com/slayyyyer/buffy
brew trust slayyyyer/buffy
brew install --cask buffy
```

Homebrew refuses to load a cask from an untrusted third-party tap, so the
`brew trust` line is not optional: skip it and the install fails with
"Refusing to load cask … from untrusted tap". It approves this tap alone, and it
is the same command the CI `Homebrew cask` job runs before `brew info`.

It is **not** submitted to `homebrew/cask` on purpose. That channel requires
casks to pass Homebrew's Gatekeeper checks, and an unsigned app cannot, so a
submission there would be rejected or later disabled. A tap is the supported
route for unsigned builds, and `brew upgrade --cask buffy` still handles updates.

Homebrew applies the quarantine attribute to cask downloads, so the first launch
still shows the unidentified-developer dialog. Approve that one app in
**System Settings → Privacy & Security → Open Anyway**. Do not disable Gatekeeper
globally, and do not treat the tap as a way around the warning.

The cask declares `arch arm: "arm64", intel: "x64"` and pins one `sha256` per
architecture with `sha256 arm: … , intel: …`, both taken from the release's own
`.dmg.sha256` assets. The URL interpolates `#{version}` and `#{arch}`, so a
release bump is the version line plus two hashes and nothing else. A
`depends_on macos: ">= :ventura"` line records Electron 45's floor.

The cask declares `auto_updates true` because Buffy ships `electron-updater` and
updates herself in place. Homebrew therefore treats the install as self-managing:
it handles the first install and skips the cask during `brew upgrade`, so a new
release reaches you through the app rather than through a second upgrade path.
If an in-app update ever leaves a broken install, `brew reinstall --cask buffy`
puts the pinned release back.

Windows has no equivalent channel, so the release installer is the install path
there. SmartScreen warns once, and **More info →
Run anyway** approves that one app.

## Checks

The cask is hand-maintained and only exercised when somebody actually taps it, so
it is checked on every push and pull request:

```bash
node scripts/check-cask.js
```

That fails when the cask drifts from `package.json` — a stale version, a hash that
is not 64 hex characters, an installer URL pointing at another release, or a
missing `app` stanza. The `Homebrew cask` CI job does what a user's machine does:
`ruby -c` on the cask, then copies the checked-out file into a temporary tap and
loads it with `brew info --cask`, which parses the real cask DSL rather than just
the syntax. Style runs alongside it, advisory only.

## When the builds get signed

If signing lands, nothing here has to change to keep working — but the cask then
becomes eligible for `homebrew/cask`. Update the hashes from the new release and
keep the same layout.
