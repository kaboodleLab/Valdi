# Valdi Linux WebGPU binding

The `vendor/` directory contains the MIT-licensed C++ JSI WebGPU layer from
[`react-native-webgpu`](https://github.com/wcandillon/react-native-webgpu),
pinned to commit `e2735d77720b9903772d4d9e5d83bc3a3a27498c`. See
`vendor/NOTICE.md` for changes made for Valdi. It uses Dawn's native WebGPU
implementation and Valdi's Hermes JSI runtime. The native Wayland probe is
`//apps/three_native:three_native_linux_webgpu_surface_probe`.

## Dawn SDK for the Valdi Linux ABI

The pinned Dawn source revision is
`9de0fd67086127228e8aa28e69616da37220cfc3`. Use its official Linux
release archive for headers. Build the static library from that exact source
revision with the **same Clang/libc++ ABI as Valdi**. The official release's
GCC/libstdc++ archive is incompatible with this Valdi Bazel toolchain.

On the Linux demo host, the source build was:

```sh
DAWN_SRC=/home/bjdodson/valdi-dawn-hermes-build/dawn-src
DAWN_BUILD=/home/bjdodson/valdi-dawn-hermes-build/build
LLVM_ROOT=/home/bjdodson/.cache/bazel/_bazel_bjdodson/fc0ab638be7e9ef9d8055b3a0669fbdf/external/+valdi_toolchains+llvm_toolchain_llvm
export PATH=/home/bjdodson/valdi-dawn-lifetime-build/.venv/bin:$PATH
export LD_LIBRARY_PATH="$LLVM_ROOT/lib/x86_64-unknown-linux-gnu:/home/bjdodson/valdi-linux-host-build/lib"
cmake -S "$DAWN_SRC" -B "$DAWN_BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER="$LLVM_ROOT/bin/clang" \
  -DCMAKE_CXX_COMPILER="$LLVM_ROOT/bin/clang++" \
  -DCMAKE_CXX_FLAGS=-stdlib=libc++ \
  -DCMAKE_EXE_LINKER_FLAGS=-stdlib=libc++ \
  -DDAWN_FETCH_DEPENDENCIES=ON -DDAWN_ENABLE_INSTALL=ON \
  -DDAWN_BUILD_SAMPLES=OFF -DDAWN_BUILD_TESTS=OFF \
  -DDAWN_BUILD_MONOLITHIC_LIBRARY=STATIC \
  -DDAWN_ENABLE_VULKAN=ON -DDAWN_ENABLE_DESKTOP_GL=OFF \
  -DDAWN_ENABLE_OPENGLES=OFF -DDAWN_ENABLE_NULL=OFF
cmake --build "$DAWN_BUILD" --target webgpu_dawn -j 8
```

The source tree must be checked out at the revision above; Dawn's dependency
fetch uses the source tree's pinned dependency list. The official release
headers reside in the archive's `include/` directory. Install both pieces:

```sh
bash apps/three_native/native_webgpu/prepare_sdk.sh \
  /path/to/Dawn-9de0fd67086127228e8aa28e69616da37220cfc3-ubuntu-latest-Release \
  "$DAWN_BUILD/src/dawn/native/libwebgpu_dawn.a"
```

The SDK files under `sdk/` are local build artifacts, excluded from Git. The
script verifies the release header revision and libc++ archive ABI. It does
not prove that an arbitrary libc++ archive has the matching Dawn revision;
build it from the pinned source tree as shown.

## Running the probes

From the Valdi checkout on the Linux Wayland desktop:

```sh
bazel build //apps/three_native:three_native_linux_webgpu_probe \
  //apps/three_native:three_native_linux_webgpu_surface_probe
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 SDL_VIDEODRIVER=wayland \
  bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe
```

The surface probe creates a Wayland window, requests a Dawn/Vulkan adapter
and device from Hermes, clears and presents the swapchain, then reads one GPU
pixel back. Passing a bundled JavaScript file to the probe runs that file in
the same Valdi/Hermes runtime after the WebGPU binding and surface are installed.
The `three_scene.js` entry is an initial Three r186 bundle for that path.

### WorldOS home scene

`three_world_home.js` imports WorldOS's `native-grid-scene.js` factory at bundle
time. That factory supplies the painted-grid node material and rounded tile
geometry from the WorldOS engine. This entry loads seven authored GLBs, using
the WorldOS Files stack's `assets/media/town/Box.glb` for Files. It also uses
the production jar's lathe profile with a Three physical glass stand-in.
Embedded images are decoded ahead of time into RGBA files because Hermes has no browser
image decoder. `GLTFLoader` still parses geometry, materials and transforms.

With Three r186, esbuild and sharp available in a Node package directory:

```sh
WORLD_OS_ROOT=/path/to/world_os
WORLD_SCENE_ROOT=/path/to/spaos/desktop/world_os
THREE_NODE_MODULES=/path/to/node_modules
NODE_PATH="$THREE_NODE_MODULES" node \
  apps/three_native/native_webgpu/prepare_world_icons.cjs \
  "$WORLD_OS_ROOT" /tmp/valdi-world-hermes-assets
NODE_PATH="$THREE_NODE_MODULES" /path/to/esbuild \
  apps/three_native/native_webgpu/three_world_home.js \
  --bundle --format=iife --platform=browser --target=es2016 \
  --alias:@worldos/native-grid-scene="$WORLD_SCENE_ROOT/kernel/engine/native-grid-scene.js" \
  --outfile=/tmp/valdi-three-world-home-bundle.js
WORLD_OS_NATIVE_ASSETS=/tmp/valdi-world-hermes-assets \
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 SDL_VIDEODRIVER=wayland \
  bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe \
  --frames=120 /tmp/valdi-three-world-home-bundle.js
```

Use `--interactive` in place of `--frames=120` to keep the window open. Mouse
motion updates the grid hover cell and clicking starts its lattice wave; Escape
closes the window. `THREE_NATIVE_LINUX_CAPTURE=/tmp/world-home.ppm` captures the
first swapchain frame by GPU readback for visual inspection. The host follows
Wayland pixel-size changes, including SPAOS fullscreen, and updates the Three
camera and WebGPU drawing buffer.

To follow an active SPAOS WorldOS volume, set `WORLD_OS_NATIVE_STATE` to its
`WorldOS/State/world.json` path. The native host reads that file without writing
to it. The scene polls its `rev`, places the jar from `layout.jar`, places
authored app props from the layout, and recognizes SPAOS app rows in `props`.
It updates the visible scene when the volume revision changes. On the demo
host, the active clean volume had jar `[1,0]` and a browser prop `[2,0]`;
the native window rendered those positions. An isolated 360-frame fixture run
observed a revision change from 1 to 2 and added a browser tile during the
same process. A full GPU frame from the active volume was inspected.

The optional `WORLD_OS_NATIVE_FLOOR` input reads a compositor `SpaceOnFloor`
snapshot. With `WORLD_OS_NATIVE_PREVIEWS` set to a directory of raw RGBA
window pictures, the scene shows the first available window on each space's
tile and updates its texture by preview generation. The native host restricts
reads to numeric `<space>.<window>.rgba` names and verifies the byte count
against the compositor's dimensions. A synthetic browser picture was rendered
through Hermes, Three and Dawn on the Linux host and visually inspected; the
existing desktop's live SPAOS picture feed has not been connected to this demo.
SPAOS can produce
metadata snapshots when started with `SPAOS_NATIVE_FLOOR_OUT`; see its
`desktop/docs/native-world-renderer.md`.

To start this renderer as SPAOS's **World client**, use `run_spaos_world.sh` as
the compositor's `--world-command`. It keeps SPAOS's inherited private World
channel and Wayland socket, supplies the metadata and preview paths, and ignores
the Electron flags that SPAOS appends to World commands. Example for an isolated
nested session (use absolute paths):

```sh
export WORLD_OS_NATIVE_ASSETS=/path/to/prepared-assets
export WORLD_OS_NATIVE_STATE=/path/to/WorldOS/State/world.json
export VALDI_WORLD_BUNDLE=/path/to/valdi-three-world-home-bundle.js
export SPAOS_WORLD_OS_X11=0
export SPAOS_NATIVE_FLOOR_OUT="$XDG_RUNTIME_DIR/native-world-floor.json"
spaos-compositor --new-window \
  --world-command /path/to/Valdi/apps/three_native/native_webgpu/run_spaos_world.sh
```

The native World scene now reads SPAOS's app catalog, enters an occupied tile on
click, and sends Leave on Escape. After leaving, it waits for the newer preview
before releasing SPAOS's departing window. These actions use the inherited
private World socket; standalone windows without that socket remain visual
probes. The standalone native host is not yet a Valdi custom view, and this
scene includes the WorldOS grid, home assets, jar and app previews rather than
the whole WorldOS HUD and application set.

```sh
WORLD_OS_NATIVE_ASSETS=/tmp/valdi-world-hermes-assets \
WORLD_OS_NATIVE_STATE=/path/to/WorldOS/State/world.json \
WORLD_OS_NATIVE_FLOOR=/path/to/floor.json \
WORLD_OS_NATIVE_PREVIEWS=/path/to/preview-directory \
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 SDL_VIDEODRIVER=wayland \
  bazel-bin/apps/three_native/three_native_linux_webgpu_surface_probe \
  --interactive /tmp/valdi-three-world-home-bundle.js
```

On the Intel Wayland host, the 120-frame run passed and a full GPU frame showed
the WorldOS grid, tiles, seven GLB props and jar geometry. A transient user
service named `valdi-world-home-hermes-v2` was left running for the GNOME demo.

This is an isolated native scene host. Its volume reader covers layout and
basic app presence, but the SPAOS compositor remains the authority for spaces,
window previews and app input. The icons do not launch apps. Integrating the
canvas with Valdi's view tree, the production jar shader and contents, HUD,
window surfaces and app actions remains separate work.
