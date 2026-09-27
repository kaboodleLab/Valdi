#!/usr/bin/env bash
# Prepare the WorldOS scene bundle and decoded assets for Valdi's Linux host.
set -euo pipefail

usage() {
  echo "usage: $0 WORLD_OS_ROOT SPAOS_WORLD_ROOT NODE_MODULES OUTPUT_DIR" >&2
  echo "Set ESBUILD_BIN when esbuild is not at NODE_MODULES/.bin/esbuild." >&2
  exit 2
}

fail() {
  echo "build_world_runtime: $*" >&2
  exit 1
}

[[ $# == 4 ]] || usage
world_root=$1
scene_root=$2
node_modules=$3
output=$4

for path in "$world_root" "$scene_root" "$node_modules" "$output"; do
  [[ $path == /* ]] || fail "all paths must be absolute: $path"
done

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
grid_scene="$scene_root/kernel/engine/native-grid-scene.js"
people_roster="$world_root/../../apps/people/roster.mjs"
shell_protocol=${SPAOS_SHELL_PROTOCOL_SOURCE:-$scene_root/../shell/src/shared/protocol.ts}
esbuild_bin=${ESBUILD_BIN:-$node_modules/.bin/esbuild}

[[ -f $grid_scene ]] || fail "WorldOS grid source is missing: $grid_scene"
[[ -f $people_roster ]] || fail "WorldOS People roster source is missing: $people_roster"
[[ -f $shell_protocol ]] || fail "SPAOS shell protocol source is missing: $shell_protocol"
[[ -d $world_root/assets/media ]] || fail "WorldOS media is missing: $world_root/assets/media"
[[ -d $node_modules/three && -d $node_modules/sharp ]] ||
  fail "NODE_MODULES must contain Three and sharp: $node_modules"
[[ -x $esbuild_bin ]] || fail "esbuild is not executable: $esbuild_bin"
command -v node >/dev/null || fail "node is not installed"
node -e "process.exit(require(process.argv[1]).version === '0.186.0' ? 0 : 1)" \
  "$node_modules/three/package.json" || fail "Three 0.186.0 is required"
[[ ! -e $output && ! -L $output ]] || fail "destination already exists: $output"

parent=$(dirname -- "$output")
mkdir -p -- "$parent"
stage=$(mktemp -d "$parent/.native-world-runtime.XXXXXXXX")
cleanup() {
  if [[ -n ${stage:-} && -d $stage ]]; then
    rm -rf -- "$stage"
  fi
}
trap cleanup EXIT

NODE_PATH="$node_modules" node "$script_dir/prepare_world_icons.cjs" \
  "$world_root" "$stage/assets"
NODE_PATH="$node_modules" "$esbuild_bin" "$script_dir/three_world_home.js" \
  --bundle --format=iife --platform=browser --target=es2016 \
  --alias:@worldos/native-grid-scene="$grid_scene" \
  --alias:@worldos/people-roster="$people_roster" \
  --outfile="$stage/world.js"
NODE_PATH="$node_modules" "$esbuild_bin" "$script_dir/native_spaos_shell.js" \
  --bundle --format=iife --platform=browser --target=es2016 \
  --alias:@spaos/shell-protocol="$shell_protocol" \
  --outfile="$stage/shell.js"

[[ -s $stage/assets/manifest.json && -s $stage/world.js && -s $stage/shell.js ]] ||
  fail "the runtime bundle is incomplete"
[[ ! -e $output && ! -L $output ]] || fail "destination appeared during build: $output"
mv -T -- "$stage" "$output"
stage=

printf 'WORLD_OS_NATIVE_ASSETS=%s/assets\nVALDI_WORLD_BUNDLE=%s/world.js\nVALDI_SHELL_BUNDLE=%s/shell.js\n' \
  "$output" "$output" "$output"
