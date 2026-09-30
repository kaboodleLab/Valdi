#!/bin/sh
set -eu

cd "$(dirname "$0")"
for tool in node node-gyp patch pkg-config; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done

node -e 'const p = require("./node_modules/@kmamal/sdl/package.json"); if (p.version !== "0.11.13") throw new Error("Expected @kmamal/sdl 0.11.13")'
package_root="$(pwd)/node_modules/@kmamal/sdl"
patch_file="$(pwd)/patches/sdl-linux-wayland.patch"

if patch --dry-run --batch --forward -p1 -d "$package_root" < "$patch_file" >/dev/null 2>&1; then
  patch --batch --forward -p1 -d "$package_root" < "$patch_file"
elif patch --dry-run --batch -R -p1 -d "$package_root" < "$patch_file" >/dev/null 2>&1; then
  echo 'SDL Wayland source patch already applied'
else
  echo 'SDL source differs from the pinned patch' >&2
  exit 1
fi

SDL_INC="$(pkg-config --variable=includedir sdl2)/SDL2"
SDL_LIB="$(pkg-config --variable=libdir sdl2)"
export SDL_INC SDL_LIB
(
  cd "$package_root"
  node-gyp rebuild --nodedir="${NODE_GYP_NODEDIR:-/usr}" --jobs="${SDL_BUILD_JOBS:-4}"
  cp build/Release/sdl.node dist/sdl.node
)
echo 'Built patched @kmamal/sdl addon'
