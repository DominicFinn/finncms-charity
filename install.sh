#!/usr/bin/env bash
# Installs the charity contact management system and puts it live on Firebase.
#
#   curl -fsSL https://raw.githubusercontent.com/DominicFinn/finncms-charity/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- https://github.com/your-charity/your-fork.git
#   ./install.sh --here        # use the copy you're in (Google Cloud Shell does this)
#
# It checks your tools, gets a copy of the code, installs it and runs
# `npm run setup`, which asks three questions. It never uses sudo and changes
# nothing on your computer without asking.
set -euo pipefail

REPO="https://github.com/DominicFinn/finncms-charity.git"
HERE=false
for arg in "$@"; do
  case "$arg" in
    --here) HERE=true ;;
    -h|--help)
      printf 'Usage: install.sh [--here] [repository URL]\n'
      exit 0
      ;;
    *) REPO="$arg" ;;
  esac
done

say() { printf '%s\n' "$*"; }
fail() { printf '\n%s\n' "$*" >&2; exit 1; }

# Piped into bash, standard input is this script, so read answers from the terminal.
ask() {
  local question="$1" default="${2:-}" answer=""
  if [ -r /dev/tty ]; then
    printf '%s' "$question${default:+ [$default]}: " > /dev/tty
    read -r answer < /dev/tty || true
  fi
  printf '%s' "${answer:-$default}"
}

say "Charity contact management: installer"
say ""

# Node 24 or later. Use nvm if it's there (Google Cloud Shell has it).
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 24 ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    say "Installing Node 24 with nvm."
    # nvm isn't written for strict mode, so relax it while nvm runs.
    set +eu
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install 24 > /dev/null
    nvm use 24 > /dev/null
    set -eu
  else
    fail "This needs Node 24 or later. Install it from https://nodejs.org, then run this again."
  fi
fi
say "Node $(node --version)"

command -v git > /dev/null || fail "This needs git. Install it from https://git-scm.com/downloads, then run this again."
say "git found"

if ! command -v gcloud > /dev/null; then
  fail "This needs the Google Cloud CLI. Install it from https://cloud.google.com/sdk/docs/install, run 'gcloud auth login', then run this again."
fi
if [ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2> /dev/null)" ]; then
  fail "The Google Cloud CLI isn't signed in. Run 'gcloud auth login', then run this again."
fi
say "gcloud signed in"

if [ "${CLOUD_SHELL:-}" != "true" ] && ! gcloud auth application-default print-access-token > /dev/null 2>&1; then
  say ""
  say "Setup needs your Google credentials saved for programs to use."
  if [ "$(ask "Run 'gcloud auth application-default login' now? (y/n)" y)" = "y" ]; then
    gcloud auth application-default login < /dev/tty
  else
    fail "Run 'gcloud auth application-default login', then run this again."
  fi
fi

# Get the code.
if [ "$HERE" = false ]; then
  DIR="$(ask "Folder to put it in" "charity-contacts")"
  if [ -d "$DIR/.git" ]; then
    say "Using the copy already in $DIR."
  else
    git clone --quiet "$REPO" "$DIR"
    say "Copied the code into $DIR."
  fi
  cd "$DIR"
fi

say "Installing. This takes a minute or two."
npm ci --no-audit --no-fund --loglevel=error

say ""
npm run --silent setup < /dev/tty

if [ "$HERE" = false ]; then
  say ""
  say "Your copy is in $(pwd). Run 'npm run deploy' there after making changes."
fi
