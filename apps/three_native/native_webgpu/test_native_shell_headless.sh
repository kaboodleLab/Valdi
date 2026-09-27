#!/usr/bin/env bash
# Linux test machine: run a separate headless SPAOS session without touching tty1/tty2.
set -euo pipefail

: "${SPAOS_COMPOSITOR:?Set SPAOS_COMPOSITOR to the test compositor binary}"
: "${VALDI_NATIVE_BINARY:?Set VALDI_NATIVE_BINARY to the test Valdi/Dawn binary}"
: "${NATIVE_RUNTIME:?Set NATIVE_RUNTIME to build_world_runtime.sh output}"
: "${WORLD_STATE:?Set WORLD_STATE to the WorldOS state file}"
: "${TEST_LOG_DIR:?Set TEST_LOG_DIR to a retained test log directory}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$TEST_LOG_DIR"
scratch=$(mktemp -d /tmp/native-shell-test.XXXXXXXX)
sway_pid=
spaos_pid=
cleanup() {
  [[ -z $spaos_pid ]] || kill "$spaos_pid" 2>/dev/null || true
  [[ -z $sway_pid ]] || kill "$sway_pid" 2>/dev/null || true
  sleep .3
  rm -rf -- "$scratch"
}
trap cleanup EXIT

export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
mkdir -p "$scratch/sway" "$scratch/config"
printf 'output HEADLESS-1 mode 1600x900\n' > "$scratch/sway/config"
env -u WAYLAND_DISPLAY -u DISPLAY -u SWAYSOCK \
  WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 \
  sway -d -c "$scratch/sway/config" > "$TEST_LOG_DIR/sway.log" 2>&1 &
sway_pid=$!
host_socket=
for _ in $(seq 1 80); do
  host_socket=$(sed -n "s/.*wayland display '\([^']*\)'.*/\1/p" "$TEST_LOG_DIR/sway.log" | head -1)
  [[ -z $host_socket ]] || break
  sleep .25
done
[[ -n $host_socket ]] || { tail -30 "$TEST_LOG_DIR/sway.log"; exit 1; }

socket="native-shell-test-$$"
WAYLAND_DISPLAY="$host_socket" SDL_VIDEODRIVER=wayland \
  SPAOS_WORLD_OS_X11=0 XDG_CONFIG_HOME="$scratch/config" \
  WORLD_OS_NATIVE_ASSETS="$NATIVE_RUNTIME/assets" \
  WORLD_OS_NATIVE_STATE="$WORLD_STATE" \
  VALDI_WORLD_BUNDLE="$NATIVE_RUNTIME/world.js" VALDI_WORLD_BINARY="$VALDI_NATIVE_BINARY" \
  VALDI_SHELL_BUNDLE="$NATIVE_RUNTIME/shell.js" VALDI_SHELL_BINARY="$VALDI_NATIVE_BINARY" \
  VALDI_SHELL_CAPTURE="$TEST_LOG_DIR/shell.ppm" \
  "$SPAOS_COMPOSITOR" --socket "$socket" \
  --world-command "$script_dir/run_spaos_world.sh" \
  --shell-command "$script_dir/run_spaos_shell.sh" > "$TEST_LOG_DIR/spaos.log" 2>&1 &
spaos_pid=$!

for _ in $(seq 1 160); do
  if grep -q 'Native SPAOS Space UI via Three' "$TEST_LOG_DIR/spaos.log"; then break; fi
  if ! kill -0 "$spaos_pid" 2>/dev/null; then break; fi
  sleep .25
done
grep -E 'Native SPAOS|the world mapped|WorldOS live state|shell.*started|spaos-space-ui|surface:|failed|error' \
  "$TEST_LOG_DIR/spaos.log" | grep -vE 'BAD_SURFACE|EGL display extensions|GL Extensions' | tail -35 || true
grep -q 'Native SPAOS Space UI via Three' "$TEST_LOG_DIR/spaos.log"
for _ in $(seq 1 80); do
  if grep -q 'Native Space UI GPU frame captured' "$TEST_LOG_DIR/spaos.log"; then break; fi
  sleep .25
done
grep -q 'Native Space UI GPU frame captured' "$TEST_LOG_DIR/spaos.log"
test -s "$TEST_LOG_DIR/shell.ppm"
python3 - "$TEST_LOG_DIR/shell.ppm" <<'PY'
from pathlib import Path
import sys

header, pixels = Path(sys.argv[1]).read_bytes().split(b'\n255\n', 1)
width, height = map(int, header.splitlines()[1].split())
assert len(pixels) == width * height * 3
def pixel(x, y):
    offset = (y * width + x) * 3
    return tuple(pixels[offset:offset + 3])
assert pixel(width // 2, height // 2) == (0, 0, 0)
assert pixel(width // 2, height - 32) != (0, 0, 0)
print(f'native shell GPU frame: {width}x{height}, transparent field and visible dock')
PY
