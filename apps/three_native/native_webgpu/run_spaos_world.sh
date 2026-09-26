#!/usr/bin/env bash
set -euo pipefail

# SPAOS appends Electron flags to --world-command even when the command is this
# native host. Do not forward those flags to the Valdi probe's argument parser.
: "${WORLD_OS_NATIVE_ASSETS:?Set WORLD_OS_NATIVE_ASSETS to the prepared RGBA and GLB directory}"
: "${WORLD_OS_NATIVE_STATE:?Set WORLD_OS_NATIVE_STATE to the WorldOS world.json file}"
: "${SPAOS_NATIVE_FLOOR_OUT:?Start SPAOS with SPAOS_NATIVE_FLOOR_OUT in XDG_RUNTIME_DIR}"
: "${VALDI_WORLD_BUNDLE:?Set VALDI_WORLD_BUNDLE to the bundled three_world_home.js file}"
: "${XDG_RUNTIME_DIR:?SPAOS must provide XDG_RUNTIME_DIR}"
: "${WAYLAND_DISPLAY:?SPAOS must provide its Wayland display}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../../.." && pwd)
world_binary=${VALDI_WORLD_BINARY:-$repo_root/bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe}

export SDL_VIDEODRIVER=wayland
export WORLD_OS_NATIVE_FLOOR="$SPAOS_NATIVE_FLOOR_OUT"
export WORLD_OS_NATIVE_PREVIEWS="$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY.previews"
exec "$world_binary" --interactive "$VALDI_WORLD_BUNDLE"
