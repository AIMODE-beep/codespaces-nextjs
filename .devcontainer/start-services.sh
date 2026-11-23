#!/usr/bin/bash

set -u

cd "$(dirname "$0")/.." || exit 1

# Keep Pixel available on port 3000 for every Codespace lifecycle start.
APP_LOCK_DIR=/tmp/pixel-app-start.lock
if mkdir "$APP_LOCK_DIR" 2>/dev/null; then
  echo $$ >"$APP_LOCK_DIR/pid"
  if ! curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
    nohup setsid npm run dev -- --hostname 0.0.0.0 --port 3000 \
      >>/tmp/pixel-next.log 2>&1 </dev/null &
  fi
  rm -rf "$APP_LOCK_DIR"
fi

APP_WATCHDOG_PID_FILE=/tmp/pixel-app-watchdog.pid
APP_WATCHDOG_RUNNING=false
if [ -f "$APP_WATCHDOG_PID_FILE" ]; then
  APP_WATCHDOG_PID="$(cat "$APP_WATCHDOG_PID_FILE" 2>/dev/null || true)"
  if [ -n "$APP_WATCHDOG_PID" ] && kill -0 "$APP_WATCHDOG_PID" 2>/dev/null; then
    APP_WATCHDOG_RUNNING=true
  fi
fi

if [ "$APP_WATCHDOG_RUNNING" != true ]; then
  nohup setsid bash -c '
    echo $$ >/tmp/pixel-app-watchdog.pid
    while true; do
      if ! curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
        npm run dev -- --hostname 0.0.0.0 --port 3000 >>/tmp/pixel-next.log 2>&1
      fi
      sleep 5
    done
  ' pixel-app-watchdog >>/dev/null 2>&1 </dev/null &
fi

OLLAMA_BIN="${OLLAMA_BIN:-}"
if [ -z "$OLLAMA_BIN" ]; then
  if [ -x "/home/codespace/.local/ollama-runtime/bin/ollama" ]; then
    OLLAMA_BIN="/home/codespace/.local/ollama-runtime/bin/ollama"
  elif command -v ollama >/dev/null 2>&1; then
    OLLAMA_BIN="$(command -v ollama)"
  fi
fi

# Ollama can be installed outside the browser session. This installs a
# persistent user-space copy on the first lifecycle startup when it is absent.
if [ -z "$OLLAMA_BIN" ] && command -v curl >/dev/null 2>&1; then
  mkdir -p /home/codespace/.local/ollama-runtime/bin
  if curl -fsSL https://ollama.com/install.sh >/tmp/pixel-install-ollama.sh; then
    sh /tmp/pixel-install-ollama.sh >/tmp/pixel-ollama-install.log 2>&1 || true
  fi
  if [ -x "/home/codespace/.local/ollama-runtime/bin/ollama" ]; then
    OLLAMA_BIN="/home/codespace/.local/ollama-runtime/bin/ollama"
  elif command -v ollama >/dev/null 2>&1; then
    OLLAMA_BIN="$(command -v ollama)"
  fi
fi

[ -n "$OLLAMA_BIN" ] || exit 0

# Serialize lifecycle starts so postCreate/postStart/postAttach cannot launch
# multiple Ollama servers or watchdogs.
LOCK_DIR=/tmp/pixel-ollama-start.lock
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_OWNER="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$LOCK_OWNER" ] && kill -0 "$LOCK_OWNER" 2>/dev/null; then
    exit 0
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null || exit 0
fi
echo $$ >"$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT

start_ollama() {
  nohup setsid env OLLAMA_HOST=127.0.0.1:11434 "$OLLAMA_BIN" serve >>/tmp/pixel-ollama.log 2>&1 </dev/null &
}

if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  start_ollama
  for _ in $(seq 1 120); do
    curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  if ! "$OLLAMA_BIN" list 2>/dev/null | grep -q '^qwen2\.5:1\.5b[[:space:]]'; then
    "$OLLAMA_BIN" pull qwen2.5:1.5b >>/tmp/pixel-ollama-pull.log 2>&1 &
  fi
fi

WATCHDOG_PID_FILE=/tmp/pixel-ollama-watchdog.pid
WATCHDOG_RUNNING=false
if [ -f "$WATCHDOG_PID_FILE" ]; then
  WATCHDOG_PID="$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)"
  if [ -n "$WATCHDOG_PID" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
    WATCHDOG_RUNNING=true
  fi
fi

if [ "$WATCHDOG_RUNNING" != true ]; then
  nohup setsid bash -c '
    echo $$ >/tmp/pixel-ollama-watchdog.pid
    while true; do
      if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
        OLLAMA_HOST=127.0.0.1:11434 "$1" serve >>/tmp/pixel-ollama.log 2>&1
      fi
      sleep 5
    done
  ' pixel-ollama-watchdog "$OLLAMA_BIN" >/dev/null 2>&1 </dev/null &
fi
