# Buffy ships unsigned, so homebrew/cask will not accept her: that channel
# requires apps to pass Gatekeeper checks. This cask lives in Buffy's own tap,
# which Homebrew allows but still quarantines, so the first launch asks for
# approval in System Settings → Privacy & Security.
cask "buffy" do
  arch arm: "arm64", intel: "x64"

  version "3.3.5"
  sha256 arm:   "1ae708a3070a87d07e405049a74d2bb8a2595f5767d5b1a8afb6f905b2de17f4",
         intel: "29b2b465f32536f4de64ff6bdc88848bc240f9963da5bee03a640899b7755cec"

  url "https://github.com/slayyyyer/buffy/releases/download/v#{version}/Buffy-#{version}-mac-#{arch}.dmg"
  name "Buffy"
  desc "Desktop companion for Claude Code, Gemini CLI, Cursor, and Freebuff"
  homepage "https://github.com/slayyyyer/buffy"

  # Electron 45 requires macOS 13, and Buffy updates herself through
  # electron-updater, so Homebrew leaves later versions to the app.
  auto_updates true
  depends_on macos: :ventura

  app "Buffy.app"

  zap trash: [
    "~/.buffy",
    "~/Library/Application Support/Buffy",
    "~/Library/Caches/com.slayyyyer.buffy",
    "~/Library/Preferences/com.slayyyyer.buffy.plist",
  ]
end
