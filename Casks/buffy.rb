# Buffy ships unsigned, so homebrew/cask will not accept her: that channel
# requires apps to pass Gatekeeper checks. This cask lives in Buffy's own tap,
# which Homebrew allows but still quarantines, so the first launch asks for
# approval in System Settings → Privacy & Security.
cask "buffy" do
  arch arm: "arm64", intel: "x64"

  version "3.3.4"
  sha256 arm:   "8b3ba4866fc0ed1e6614f743734e06ca0bb24e1e45914b1ab21f5f21973608a8",
         intel: "46cec6682842d77a4a023acd391156e647eee23d5edc854846b4920039bc665b"

  url "https://github.com/slayyyyer/buffy/releases/download/v#{version}/Buffy-#{version}-mac-#{arch}.dmg"
  name "Buffy"
  desc "Desktop companion for Claude Code, Gemini CLI, Cursor, and Freebuff"
  homepage "https://github.com/slayyyyer/buffy"

  # Electron 45 requires macOS 13, and Buffy updates herself through
  # electron-updater, so Homebrew leaves later versions to the app.
  auto_updates true
  depends_on macos: ">= :ventura"

  app "Buffy.app"

  zap trash: [
    "~/.buffy",
    "~/Library/Application Support/Buffy",
    "~/Library/Caches/com.slayyyyer.buffy",
    "~/Library/Preferences/com.slayyyyer.buffy.plist",
  ]
end
