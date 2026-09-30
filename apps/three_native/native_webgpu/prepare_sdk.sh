#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || ! -f "$1/include/webgpu/webgpu_cpp.h" || ! -f "$2" ]]; then
  echo "Usage: $0 /path/to/Dawn-9de0fd...-ubuntu-latest-Release /path/to/libc++/libwebgpu_dawn.a" >&2
  exit 2
fi

prefix=$(cd "$1" && pwd)
library=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
sdk_dir=$(cd "$(dirname "$0")/sdk" && pwd)
expected_header=1166cea03743213cbd0a7fe04b01c8bcae8aa117d1370c124572c65b24f74aac
actual_header=$(sha256sum "$prefix/include/webgpu/webgpu_cpp.h" | cut -d' ' -f1)
if [[ "$actual_header" != "$expected_header" ]]; then
  echo "Dawn headers do not match tested source revision 9de0fd67086127228e8aa28e69616da37220cfc3" >&2
  exit 1
fi
if ! nm -C "$library" | awk '/std::__1::/ { found = 1 } END { exit !found }'; then
  echo "Dawn archive must be built against libc++ (Valdi's Linux C++ ABI)" >&2
  exit 1
fi

mkdir -p "$sdk_dir/include" "$sdk_dir/lib64"
cp -R "$prefix/include/." "$sdk_dir/include/"
cp "$library" "$sdk_dir/lib64/libwebgpu_dawn.a"
echo "Installed pinned Dawn headers and ABI-compatible static library in $sdk_dir"
