#!/usr/bin/env bash
set -euo pipefail

# SPAOS provides the private Shell capability socket and Wayland display.
# It may append Electron flags to --shell-command; the native host ignores them.
: "${SPAOS_SHELL_CHANNEL_FD:?SPAOS must provide its Shell capability}"
: "${WORLD_OS_NATIVE_ASSETS:?Set WORLD_OS_NATIVE_ASSETS to prepared assets}"
: "${VALDI_SHELL_BUNDLE:?Set VALDI_SHELL_BUNDLE to the bundled shell.js}"
: "${XDG_RUNTIME_DIR:?SPAOS must provide XDG_RUNTIME_DIR}"
: "${WAYLAND_DISPLAY:?SPAOS must provide its Wayland display}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../../.." && pwd)
shell_binary=${VALDI_SHELL_BINARY:-$repo_root/bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe}
export SDL_VIDEODRIVER=wayland
if [[ -n ${VALDI_SHELL_CAPTURE:-} ]]; then
  export THREE_NATIVE_LINUX_CAPTURE="$VALDI_SHELL_CAPTURE"
fi
exec "$shell_binary" --interactive --shell-client "$VALDI_SHELL_BUNDLE"
