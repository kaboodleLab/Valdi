#!/usr/bin/env bash
set -euo pipefail

# SPAOS appends Electron flags to --world-command even when the command is this
# native host. Do not forward those flags to the Valdi probe's argument parser.
: "${WORLD_OS_NATIVE_ASSETS:?Set WORLD_OS_NATIVE_ASSETS to the prepared RGBA and GLB directory}"
: "${WORLD_OS_NATIVE_STATE:?Set WORLD_OS_NATIVE_STATE to the WorldOS world.json file}"
: "${VALDI_WORLD_BUNDLE:?Set VALDI_WORLD_BUNDLE to the bundled three_world_home.js file}"
: "${XDG_RUNTIME_DIR:?SPAOS must provide XDG_RUNTIME_DIR}"
: "${WAYLAND_DISPLAY:?SPAOS must provide its Wayland display}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../../.." && pwd)
world_binary=${VALDI_WORLD_BINARY:-$repo_root/bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe}

export SDL_VIDEODRIVER=wayland
# The live floor arrives on SPAOS's inherited World channel. A file snapshot
# remains useful for standalone debugging and older compositor builds.
if [[ -n ${SPAOS_NATIVE_FLOOR_OUT:-} ]]; then
  export WORLD_OS_NATIVE_FLOOR="$SPAOS_NATIVE_FLOOR_OUT"
fi
export WORLD_OS_NATIVE_PREVIEWS="$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY.previews"

# The companion uses SPAOS's authenticated frontend transport. In standalone
# probes without a SPAOS service root, keep the original single-process path.
if [[ ${SPAOS_AGENT_SERVICE:-0} != 1 || -z ${SPAOS_WORLD_OS_ROOT:-} ]]; then
  exec "$world_binary" --interactive "$VALDI_WORLD_BUNDLE"
fi
export WORLD_OS_NATIVE_ROSTER=$(mktemp "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY.native-roster.XXXXXXXX")
agent_dir=$(mktemp -d "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY.native-agent.XXXXXXXX")
chmod 700 "$agent_dir"
export WORLD_OS_NATIVE_AGENT_SOCKET="$agent_dir/agent.sock"
node "$script_dir/native_people_roster_bridge.mjs" &
roster_pid=$!
for _ in {1..100}; do
  [[ -S $WORLD_OS_NATIVE_AGENT_SOCKET ]] && break
  if ! kill -0 "$roster_pid" 2>/dev/null; then
    echo 'Native World companion exited before its agent socket opened' >&2
    rm -f "$WORLD_OS_NATIVE_ROSTER"
    rmdir "$agent_dir"
    exit 1
  fi
  sleep .05
done
if [[ ! -S $WORLD_OS_NATIVE_AGENT_SOCKET ]]; then
  echo 'Native World companion did not open its agent socket' >&2
  kill -TERM "$roster_pid" 2>/dev/null || true
  wait "$roster_pid" 2>/dev/null || true
  rm -f "$WORLD_OS_NATIVE_ROSTER"
  rmdir "$agent_dir"
  exit 1
fi
"$world_binary" --interactive "$VALDI_WORLD_BUNDLE" &
world_pid=$!
trap 'kill -TERM "$world_pid" "$roster_pid" 2>/dev/null || true' INT TERM
status=0
finished=
wait -n -p finished "$world_pid" "$roster_pid" || status=$?
if [[ $finished == "$roster_pid" ]]; then
  echo 'Native World companion exited before its renderer' >&2
  status=1
fi
kill -TERM "$world_pid" "$roster_pid" 2>/dev/null || true
wait "$world_pid" 2>/dev/null || true
wait "$roster_pid" 2>/dev/null || true
rm -f "$WORLD_OS_NATIVE_ROSTER"
rm -f "$WORLD_OS_NATIVE_AGENT_SOCKET"
rmdir "$agent_dir" 2>/dev/null || true
exit "$status"
