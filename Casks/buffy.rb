# Buffy ships unsigned, so homebrew/cask will not accept her: that channel
# requires apps to pass Gatekeeper checks. This cask lives in Buffy's own tap,
# which Homebrew allows but still quarantines, so the first launch asks for
# approval in System Settings → Privacy & Security.
cask "buffy" do
  arch arm: "arm64", intel: "x64"

  version "3.4.0"
  sha256 arm:   "1cb303c6f69c1ba5f665c922255e8be64fd1c6b8d54de98174a36bafa4f1d87b",
         intel: "08a676eff1e61030abb1c0bfff5cb97b43b013b38d7c4ce5a5908a2cf343ec3c"

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
