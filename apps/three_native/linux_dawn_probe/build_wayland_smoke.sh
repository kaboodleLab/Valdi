#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1/lib64/libwebgpu_dawn.a" || ! -f "$1/include/webgpu/webgpu.h" ]]; then
  echo "Usage: $0 /path/to/extracted/Dawn-Linux-Release" >&2
  exit 2
fi

dawn_prefix=$(cd "$1" && pwd)
probe_dir=$(cd "$(dirname "$0")" && pwd)

g++ -O2 -std=c++20 \
  $(pkg-config --cflags sdl3) \
  -I "$dawn_prefix/include" \
  "$probe_dir/wayland_dawn_smoke.cpp" \
  "$dawn_prefix/lib64/libwebgpu_dawn.a" \
  $(pkg-config --libs sdl3) -ldl -pthread \
  -o "$probe_dir/wayland_dawn_smoke"
