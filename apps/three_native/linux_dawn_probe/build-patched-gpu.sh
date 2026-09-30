#!/bin/sh
set -eu

cd "$(dirname "$0")"
probe_root="$(pwd)"
for tool in node git cmake ninja python3; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done

package_root="$(pwd)/node_modules/@kmamal/gpu"
test -f "$package_root/package.json" || { echo 'Run npm ci first' >&2; exit 1; }
node patch-kmamal-gpu-lifetime.mjs

cd "$package_root"
node scripts/download-depot-tools.mjs
node scripts/download-dawn.mjs
git -C dawn apply "$probe_root/patches/dawn-linux-wayland.patch"
git -C dawn apply "$probe_root/patches/dawn-surface-resize.patch"
cp dawn/scripts/standalone-with-node.gclient dawn/.gclient
(
  cd dawn
  PATH="$package_root/depot_tools:$PATH" DEPOT_TOOLS_UPDATE=0 \
    "$package_root/depot_tools/gclient" sync --no-history -j8
)

clang_bin="$package_root/dawn/third_party/llvm-build/Release+Asserts/bin"
go_bin="$package_root/dawn/tools/golang/bin"
test -x "$clang_bin/clang++" || { echo 'Dawn Clang was not downloaded' >&2; exit 1; }
test -x "$go_bin/go" || { echo 'Dawn Go was not downloaded' >&2; exit 1; }

cmake -S "$package_root/dawn" -B "$package_root/build" -GNinja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER="$clang_bin/clang" \
  -DCMAKE_CXX_COMPILER="$clang_bin/clang++" \
  -DDAWN_BUILD_NODE_BINDINGS=ON \
  -DDAWN_BUILD_SAMPLES=OFF \
  -DTINT_BUILD_TESTS=OFF \
  -DTINT_BUILD_CMD_TOOLS=OFF \
  -DDAWN_USE_GLFW=OFF \
  -DDAWN_SUPPORTS_GLFW_FOR_WINDOWING=OFF \
  -DDAWN_ENABLE_PIC=ON \
  -DDAWN_ENABLE_SPIRV_VALIDATION=ON \
  -DDAWN_ALWAYS_ASSERT=ON \
  -DDAWN_USE_X11=ON \
  -DDAWN_USE_WAYLAND=ON

PATH="$go_bin:$PATH" ninja -C "$package_root/build" -j "${DAWN_BUILD_JOBS:-4}" dawn.node
mkdir -p "$package_root/dist"
cp "$package_root/build/dawn.node" "$package_root/dist/dawn.node"
echo 'Built patched @kmamal/gpu Dawn addon'
