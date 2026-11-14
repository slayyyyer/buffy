cask "buffy" do
  version "3.3.4"
  name "Buffy"
  desc "Desktop companion for Claude Code, Gemini CLI, Cursor, and Freebuff"
  homepage "https://github.com/slayyyyer/buffy"

  # Buffy's macOS builds are unsigned, so homebrew/cask will not accept them:
  # that channel requires apps to pass Gatekeeper. This cask lives in Buffy's
  # own tap, which Homebrew allows. Homebrew still sets the quarantine bit, so
  # the first launch asks for approval in System Settings → Privacy & Security.
  on_arm do
    sha256 "8b3ba4866fc0ed1e6614f743734e06ca0bb24e1e45914b1ab21f5f21973608a8"
    url "https://github.com/slayyyyer/buffy/releases/download/v#{version}/Buffy-#{version}-mac-arm64.dmg"
  end

  on_intel do
    sha256 "46cec6682842d77a4a023acd391156e647eee23d5edc854846b4920039bc665b"
    url "https://github.com/slayyyyer/buffy/releases/download/v#{version}/Buffy-#{version}-mac-x64.dmg"
  end

  # Buffy updates herself through electron-updater, so Homebrew installs her and
  # leaves later versions to the app instead of racing its own upgrade path.
  auto_updates true

  app "Buffy.app"

  zap trash: [
    "~/.buffy",
    "~/Library/Application Support/Buffy",
    "~/Library/Caches/com.slayyyyer.buffy",
    "~/Library/Preferences/com.slayyyyer.buffy.plist",
  ]
end
