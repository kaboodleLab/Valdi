# Linux Dawn/Three.js display probe

This probe runs **Three.js r186 `WebGPURenderer` itself** on Linux through
Dawn's Vulkan backend. It loads the WorldOS platter GLB and its glTF material,
then renders and animates it. On the test machine, Dawn selected Intel Xe
graphics under Mesa 26.2.2. The GNOME Wayland window used SDL2.

This isolates two questions from Valdi integration: whether Three's renderer
works with native Dawn on this Linux GPU, and whether a native window can show
its frames. Both worked on the `192.168.1.41` machine.

## Run on Linux

From this directory in a Linux checkout:

```sh
npm ci --no-audit --no-fund
node run.mjs
g++ -O2 -std=c++17 viewer.cpp -o viewer $(pkg-config --cflags --libs sdl2)
node run.mjs --stream | ./viewer
```

The still image is written to `linux-dawn-platter.ppm`. Close the live window
or press Escape to stop the viewer. From SSH, set `XDG_RUNTIME_DIR` and
`WAYLAND_DISPLAY` to the desktop session before launching; the GNOME session
on the test machine used `/run/user/1000` and `wayland-0`.

## Scope

The `canvas` object in `run.mjs` presents a WebGPU context backed by an
offscreen `GPUTexture`. The live viewer copies each texture back to CPU memory
and uploads it to an SDL window. This is a diagnostic presentation path, with
a GPU readback and copy **every frame**. It is not the intended runtime
architecture or a performance baseline.

The next milestone is a Wayland-backed Dawn `WGPUSurface` presented directly
from a `GPUCanvasContext`, with the WebGPU binding installed into Valdi's
JavaScript runtime. Valdi currently creates a Linux standalone runtime without
a display host. React Native WebGPU has reusable Dawn/WebGPU JSI bindings, but
its React Native scheduling and platform surface ownership must be adapted to
Valdi. The Android GLSurfaceView triangle adapter remains a separate first
slice; it does not provide Three's renderer API.

The WorldOS asset is for local validation; its distribution license has not
been resolved.
