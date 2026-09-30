#!/usr/bin/env bash
set -euo pipefail

: "${SPAOS_SHELL_CHANNEL_FD:?SPAOS must provide its Shell capability}"
: "${SPAOS_DESKTOP_ROOT:?Set SPAOS_DESKTOP_ROOT to the matching desktop tree}"
: "${SPAOS_ELECTRON_BINARY:?Set SPAOS_ELECTRON_BINARY to the installed app runtime}"
: "${VALDI_SHELL_BUNDLE:?Set VALDI_SHELL_BUNDLE to the bundled shell.js}"
: "${WORLD_OS_NATIVE_ASSETS:?Set WORLD_OS_NATIVE_ASSETS to prepared assets}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../../.." && pwd)
export VALDI_SHELL_BINARY=${VALDI_SHELL_BINARY:-$repo_root/bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe}
controller=${VALDI_SHELL_CONTROLLER:-$script_dir/native_spaos_shell_controller.cjs}
exec node "$controller"
