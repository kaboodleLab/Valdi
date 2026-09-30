#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cache_root="${VALDI_THREE_BUILD_CACHE:-$repo_root/.local-three-build}"
mkdir -p "$cache_root"

# Valdi's Bazel Swift rule requires Xcode. Swift from Command Line Tools can
# still build the compiler for this Android-only target.
swift build \
  --package-path "$repo_root/compiler/compiler/Compiler" \
  --scratch-path "$cache_root/swift" \
  -c release -Xswiftc -DDEBUG
compiler_repo="$cache_root/compiler-repo"
mkdir -p "$compiler_repo"
ln -sf "$cache_root/swift/release/Compiler" "$compiler_repo/valdi_compiler"
printf 'exports_files(["valdi_compiler"], visibility = ["//visibility:public"])\n' > "$compiler_repo/BUILD.bazel"
: > "$compiler_repo/WORKSPACE"

cd "$repo_root"
bazel_startup=()
if [[ -n "${BAZEL_OUTPUT_USER_ROOT:-}" ]]; then
  bazel_startup+=("--output_user_root=$BAZEL_OUTPUT_USER_ROOT")
fi
output_base="$(bazel "${bazel_startup[@]}" info output_base)"
apple_source="$output_base/external/apple_support+"
if [[ ! -f "$apple_source/rules/apple_genrule.bzl" ]]; then
  bazel "${bazel_startup[@]}" fetch @build_bazel_apple_support//rules:apple_genrule.bzl
fi
apple_repo="$cache_root/apple-support-clt"
if [[ ! -f "$apple_repo/rules/apple_genrule.bzl" ]]; then
  mkdir -p "$apple_repo"
  cp -R "$apple_source/." "$apple_repo/"
  python3 - "$apple_repo/rules/apple_genrule.bzl" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
needle = 'def apple_genrule(name, **kwargs):\n    """Genrule which provides Apple specific environment and make variables."""\n'
if needle not in text:
    raise SystemExit('Unexpected apple_support apple_genrule.bzl layout')
text = text.replace(needle, needle + '\n    native.genrule(name = name, **kwargs)\n    return\n', 1)
path.write_text(text)
PY
fi

# The Mac host tools otherwise pass Xcode version "None" into Bazel's Apple
# environment provider, and this SDK rejects the repo's old 10.15 target.
bazel "${bazel_startup[@]}" build //apps/three_native:three_native_android \
  --define=client_repo_arm64=true \
  --platforms=@snap_platforms//os:android_arm64 \
  --//bzl/valdi:use_local_compiler=false \
  "--override_repository=+valdi_compiler_repos+valdi_compiler_macos=$compiler_repo" \
  "--override_repository=apple_support+=$apple_repo" \
  --host_macos_minimum_os=15.0 \
  --macos_minimum_os=15.0 \
  "$@"
