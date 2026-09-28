#!/usr/bin/env bash
# Bundle the headless shell controller and catalog probe from SPAOS's TypeScript.
set -euo pipefail

if [[ $# != 2 || $1 != /* || $2 != /* ]]; then
  echo "usage: $0 SPAOS_SHELL_SOURCE_DIR OUTPUT_DIR" >&2
  exit 2
fi
source_dir=$1
output_dir=$2
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
esbuild_bin=${ESBUILD_BIN:-esbuild}
command -v "$esbuild_bin" >/dev/null || { echo "esbuild not found: $esbuild_bin" >&2; exit 2; }
[[ ! -e $output_dir && ! -L $output_dir ]] || {
  echo "destination already exists: $output_dir" >&2; exit 2;
}
for module in app-catalog installed-apps app-manifests app-roots desktop-entries package-manager-client compositor-client settings verbs; do
  [[ -f $source_dir/main/$module.ts ]] || {
    echo "missing SPAOS shell source: $source_dir/main/$module.ts" >&2; exit 2;
  }
done
[[ -f $source_dir/shared/protocol.ts ]] || {
  echo "missing SPAOS shell protocol: $source_dir/shared/protocol.ts" >&2; exit 2;
}

parent=$(dirname "$output_dir")
mkdir -p "$parent"
stage=$(mktemp -d "$parent/.native-shell-catalog.XXXXXXXX")
trap '[[ ! -d ${stage:-} ]] || rm -rf -- "$stage"' EXIT
"$esbuild_bin" "$script_dir/probe_spaos_catalog.mjs" \
  --bundle --platform=node --format=cjs --target=node20 \
  --alias:@spaos/app-catalog="$source_dir/main/app-catalog.ts" \
  --alias:@spaos/installed-apps="$source_dir/main/installed-apps.ts" \
  --alias:@spaos/app-manifests="$source_dir/main/app-manifests.ts" \
  --alias:@spaos/app-roots="$source_dir/main/app-roots.ts" \
  --alias:@spaos/desktop-entries="$source_dir/main/desktop-entries.ts" \
  --alias:@spaos/package-manager-client="$source_dir/main/package-manager-client.ts" \
  --outfile="$stage/probe_spaos_catalog.cjs"
"$esbuild_bin" "$script_dir/native_spaos_shell_controller.mjs" \
  --bundle --platform=node --format=cjs --target=node20 \
  --alias:@spaos/app-catalog="$source_dir/main/app-catalog.ts" \
  --alias:@spaos/installed-apps="$source_dir/main/installed-apps.ts" \
  --alias:@spaos/app-manifests="$source_dir/main/app-manifests.ts" \
  --alias:@spaos/app-roots="$source_dir/main/app-roots.ts" \
  --alias:@spaos/desktop-entries="$source_dir/main/desktop-entries.ts" \
  --alias:@spaos/package-manager-client="$source_dir/main/package-manager-client.ts" \
  --alias:@spaos/compositor-client="$source_dir/main/compositor-client.ts" \
  --alias:@spaos/settings="$source_dir/main/settings.ts" \
  --alias:@spaos/verbs="$source_dir/main/verbs.ts" \
  --alias:@spaos/shell-protocol="$source_dir/shared/protocol.ts" \
  --outfile="$stage/native_spaos_shell_controller.cjs"
[[ -s $stage/probe_spaos_catalog.cjs && -s $stage/native_spaos_shell_controller.cjs ]] || exit 1
mv -T -- "$stage" "$output_dir"
stage=
printf 'PROBE=%s/probe_spaos_catalog.cjs\nCONTROLLER=%s/native_spaos_shell_controller.cjs\n' \
  "$output_dir" "$output_dir"
