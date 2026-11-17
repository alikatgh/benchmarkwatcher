#!/bin/sh
set -eu

# Xcode Cloud post-clone hook: keep project.yml authoritative.
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_ANALYTICS=1

if ! command -v xcodegen >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install xcodegen
  elif [ -x /opt/homebrew/bin/brew ]; then
    /opt/homebrew/bin/brew install xcodegen
  elif [ -x /usr/local/bin/brew ]; then
    /usr/local/bin/brew install xcodegen
  else
    echo "error: xcodegen is unavailable in this environment" >&2
    exit 1
  fi
fi

cd "$(dirname "$0")/.."
xcodegen generate --spec project.yml
