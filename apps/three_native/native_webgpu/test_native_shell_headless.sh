#!/usr/bin/env bash
# Linux test machine: run a separate headless SPAOS session without touching tty1/tty2.
set -euo pipefail

: "${SPAOS_COMPOSITOR:?Set SPAOS_COMPOSITOR to the test compositor binary}"
: "${VALDI_NATIVE_BINARY:?Set VALDI_NATIVE_BINARY to the test Valdi/Dawn binary}"
: "${NATIVE_RUNTIME:?Set NATIVE_RUNTIME to build_world_runtime.sh output}"
: "${WORLD_STATE:?Set WORLD_STATE to the WorldOS state file}"
: "${TEST_LOG_DIR:?Set TEST_LOG_DIR to a retained test log directory}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
shell_command=${SHELL_COMMAND:-$script_dir/run_spaos_shell.sh}
if [[ ${EXPECT_HOST_LAUNCH:-0} == 1 ]]; then
  export EXPECT_LAUNCH_APP=test-native-host.desktop
fi
if [[ -n ${EXPECT_LAUNCH_APP:-} && ! $EXPECT_LAUNCH_APP =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$ ]]; then
  echo "EXPECT_LAUNCH_APP must be a canonical package name" >&2
  exit 2
fi
mkdir -p "$TEST_LOG_DIR"
scratch=$(mktemp -d /tmp/native-shell-test.XXXXXXXX)
if [[ ${EXPECT_HOST_LAUNCH:-0} == 1 ]]; then
  export XDG_DATA_HOME="$scratch/data"
  mkdir -p "$XDG_DATA_HOME/applications"
  cat > "$XDG_DATA_HOME/applications/test-native-host.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Native Host Probe
Exec=/usr/bin/true
Terminal=false
DESKTOP
fi
world_bundle=${WORLD_BUNDLE:-$NATIVE_RUNTIME/world.js}
if [[ -n ${EXPECT_LAUNCH_APP:-} ]]; then
  cp -- "$world_bundle" "$scratch/world-open-test.js"
  printf "\nsetTimeout(() => { __nativeWorldOpen('%s', 9, 0); __webgpuSurfaceStage('WorldOS native launch probe requested %s'); }, 2500);\n" \
    "$EXPECT_LAUNCH_APP" "$EXPECT_LAUNCH_APP" >> "$scratch/world-open-test.js"
  world_bundle="$scratch/world-open-test.js"
fi
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
  VALDI_WORLD_BUNDLE="$world_bundle" VALDI_WORLD_BINARY="$VALDI_NATIVE_BINARY" \
  VALDI_SHELL_BUNDLE="${SHELL_BUNDLE:-$NATIVE_RUNTIME/shell.js}" VALDI_SHELL_BINARY="$VALDI_NATIVE_BINARY" \
  VALDI_SHELL_CAPTURE="$TEST_LOG_DIR/shell.ppm" \
  "$SPAOS_COMPOSITOR" --socket "$socket" \
  --world-command "$script_dir/run_spaos_world.sh" \
  --shell-command "$shell_command" > "$TEST_LOG_DIR/spaos.log" 2>&1 &
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
grep -Eq 'Native Space UI GPU frame captured.*alpha 0/[1-9][0-9]*' "$TEST_LOG_DIR/spaos.log"
test -s "$TEST_LOG_DIR/shell.ppm"
if [[ ${EXPECT_CATALOG:-0} == 1 ]]; then
  grep -Eq 'WorldOS app catalog received: [1-9][0-9]* visible apps' "$TEST_LOG_DIR/spaos.log"
  grep -Eq 'published [1-9][0-9]* authenticated SPAOS apps' "$TEST_LOG_DIR/spaos.log"
fi
if [[ -n ${EXPECT_LAUNCH_APP:-} ]]; then
  kind=world
  marker=digest-bound
  if [[ ${EXPECT_HOST_LAUNCH:-0} == 1 ]]; then
    kind=
    marker=host
  fi
  for _ in $(seq 1 100); do
    if grep -q "requested $marker launch of $kind${kind:+:}$EXPECT_LAUNCH_APP" "$TEST_LOG_DIR/spaos.log"; then break; fi
    sleep .25
  done
  grep -q "requested $marker launch of $kind${kind:+:}$EXPECT_LAUNCH_APP" "$TEST_LOG_DIR/spaos.log"
  for _ in $(seq 1 100); do
    if [[ ${EXPECT_HOST_LAUNCH:-0} == 1 ]]; then
      if grep 'spawned' "$TEST_LOG_DIR/spaos.log" | grep -q '/usr/bin/true'; then break; fi
    elif grep 'started app runtime instance' "$TEST_LOG_DIR/spaos.log" | grep -q "package.*$EXPECT_LAUNCH_APP"; then break; fi
    sleep .25
  done
  if [[ ${EXPECT_HOST_LAUNCH:-0} == 1 ]]; then
    grep 'spawned' "$TEST_LOG_DIR/spaos.log" | grep -q '/usr/bin/true'
  else
    grep 'started app runtime instance' "$TEST_LOG_DIR/spaos.log" | grep -q "package.*$EXPECT_LAUNCH_APP"
  fi
fi
if [[ -n ${EXPECT_MAPPED_APP_ID:-} ]]; then
  for _ in $(seq 1 120); do
    if grep 'toplevel mapped' "$TEST_LOG_DIR/spaos.log" | grep -Fq "$EXPECT_MAPPED_APP_ID"; then break; fi
    sleep .25
  done
  grep 'toplevel mapped' "$TEST_LOG_DIR/spaos.log" | grep -Fq "$EXPECT_MAPPED_APP_ID"
fi
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
assert pixel(width * 3 // 4, height - 43) != (0, 0, 0)
print(f'native shell GPU frame: {width}x{height}, transparent field and visible dock')
PY
