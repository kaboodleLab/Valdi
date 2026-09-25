# Valdi + Three.js native Android slice and Linux probes

This example imports **Three.js r186** inside Valdi's JavaScript runtime, parses
World OS's existing `assets/media/props/ui-platter-base.glb` with the matching
`GLTFLoader`, animates its `Object3D`, and presents its triangles in a Valdi
`<custom-view>` backed by Android OpenGL ES 3. The model bytes are bundled
without image conversion. Its SHA-256 in the source checkout is
`b119a05cb92b5caf9a2d510413063753dc3f4f5a48750d3d851753581d23942a`.

## Decision and scope

The World OS renderer defaults to Three r186 `WebGPURenderer` with a WebGL 2
fallback (`world_os/kernel/engine/renderer-session.js`);
it also has a legacy `WebGLRenderer` path. Valdi has JavaScript runtime and
native view seams, but does not expose a browser `GPUCanvasContext` or WebGL 2
context to that runtime. Three's `WebGPURenderer` has a narrower `Backend`
interface, yet the r186 backend still owns shader compilation, pipelines,
buffers, textures and render targets. The initial scene needs none of the
World OS screen capture or custom shader paths, so this adapter uses the
scene graph and a narrow triangle transport to an OpenGL ES surface. It is a
first vertical slice, **not a WebGL/WebGPU implementation for Three**. The
full World OS scene cannot run through this renderer yet.

Relevant Valdi interfaces: JavaScript context creation and dispatch in
`valdi/src/valdi/runtime/JavaScript/JavaScriptRuntime.cpp`; zero-copy
Hermes ArrayBuffer access in `valdi/src/valdi/hermes/HermesJavaScriptContext.cpp`;
typed-array to Java byte-array conversion in
`valdi_core/src/valdi_core/jni/JavaUtils.cpp`; timer scheduling in
`src/valdi_modules/src/valdi/valdi_core/src/PostInit.ts`; native class and
attribute resolution in `valdi/src/java/com/snap/valdi/nativebridge/ReflectionViewFactory.kt`.
Valdi's existing Android drawing stack creates its own EGL ES2 context in
`snap_drawing/src/snap_drawing/cpp/Drawing/GraphicsContext/ANativeWindowGraphicsContext.cpp`,
so sharing that context would not supply ES3/WebGL 2 to Three.

For the full renderer, [Expo GL's WebGL bridge](https://github.com/expo/expo/blob/main/packages/expo-gl/common/EXWebGLMethods.cpp)
is a stronger starting point for Android WebGL 2 than hand-writing calls.
[React Native WebGPU's Dawn binding](https://github.com/wcandillon/react-native-webgpu/tree/main/packages/webgpu/cpp)
is the corresponding WebGPU candidate, but its JSI host-object layer would
need adaptation to Valdi's JavaScript context interface. Dawn itself supports
Metal and Vulkan via its native implementation. Neither library has been
ported into this example.

```text
Valdi TS component -> Three r186 scene + GLTFLoader -> typed vertex/matrix arrays
       |                                                   |
       +------ layout, drag, timer -------------------------+
                                                           v
                                    Valdi custom-view attribute marshalling
                                                           v
                             Android GLSurfaceView -> GLES3 VBO -> display
```

The 78,048-byte expanded triangle stream crosses the JS/native boundary once
per model load. Each animation frame sends 128 bytes for the model and
projection matrices; JNI marshalling copies that array into a Java `byte[]`.
The GL thread uploads geometry once per context and updates two uniforms per
frame. Valdi's state render runs at about 30 Hz; this is functional but not a
display-synchronized production scheduler. No GPU readback is used.
The vendored Three r186 modules are lowered to ES2018 CommonJS with
extensionless local imports for Valdi's module loader and minifier. An
`AbortController` shim covers the API Three's loaders construct when parsing
an in-memory GLB in Hermes. This module uses Valdi's `js` compilation mode
because its Android release bytecode precompiler does not accept these modules.

## Build and run

From this Valdi worktree, with Bazelisk and JDK 17 installed:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"
bazel build //apps/three_native:three_native_android --define=client_repo_arm64=true
adb install -r bazel-bin/apps/three_native/three_native_android.apk
adb shell monkey -p com.snap.valdi.three_native 1
```

On this Mac, the open-source Bazel build encounters two host-tool issues with
Command Line Tools alone: the Swift compiler rule expects Xcode, and
`apple_support` receives the invalid Xcode version `None`. The following
script builds Valdi's Swift compiler directly and prepares a local
Command Line Tools override for the Android build:

```sh
export BAZEL_OUTPUT_USER_ROOT=/Users/bjdodson/code/.tools/bazel-output
bash apps/three_native/scripts/build_android_macos.sh
```

The script caches generated files in `.local-three-build/` and copies the
Apache-licensed `apple_support` Bazel repository there with a local Android
host-tool patch. On a host without the JDK path above, use any JDK 17.
Use an arm64 Android device or emulator with GLES 3. Run the JavaScript asset and
animation test and the host-side timing benchmark independently:

```sh
node --test apps/three_native/test/scene.test.mjs
node apps/three_native/test/bench.mjs
```

### Emulator validation

The APK was installed and run on an Android 35 Google APIs arm64 emulator
(`valdi_three_api35`) on Apple Silicon. The World OS platter appeared and
changed angle between screenshots. It remained visible after a swipe and
after returning from Home. The portrait camera fit was adjusted so the broad
face stays within the display. To repeat with a running arm64 GLES 3 emulator:

```sh
adb devices -l
adb install -r bazel-bin/apps/three_native/three_native_android.apk
adb shell am start -n com.snap.valdi.three_native/.StartActivity
adb shell input swipe 200 500 800 500 600
adb shell input keyevent KEYCODE_HOME
adb shell am start -n com.snap.valdi.three_native/.StartActivity
adb shell screencap -p /sdcard/Download/three-native.png
adb pull /sdcard/Download/three-native.png ./three-native.png
adb logcat -d -s AndroidRuntime:E
```

The local SDK and AVD are at `~/code/.tools/android-sdk` and
`~/code/.tools/android-avd`. Launch the installed emulator with:

```sh
export ANDROID_SDK_ROOT="$HOME/code/.tools/android-sdk"
export ANDROID_USER_HOME="$HOME/code/.tools/android-user"
export ANDROID_AVD_HOME="$HOME/code/.tools/android-avd"
"$ANDROID_SDK_ROOT/emulator/emulator" -avd valdi_three_api35 \
  -no-window -no-snapshot -no-audio -no-boot-anim -gpu auto
```

The emulator uses software GPU emulation, so its timing is not representative
of a phone. Frame time and JavaScript-to-Java copy cost still need on-device
measurement. Screen rotation has not yet been validated on the emulator.

## Linux path

Linux can build and run the **Android** target. Valdi's Linux setup guide
documents `valdi dev_setup`, JDK 17 and Bazel; use an Android emulator with
KVM acceleration or an Android device. This arm64 APK targets an arm64
emulator/device. A typical x86_64 Linux emulator needs a separately built
x86_64 Android APK. The repo's platform rules select that ABI with:

```sh
bazel build //apps/three_native:three_native_android \
  --define=client_repo_x86_64=true \
  --platforms=@snap_platforms//os:android_x86_64
```

That x86_64 build command has not yet been run on a Linux host.

Linux **desktop** is a separate target. Valdi defines a `_linux` application
target. The Linux entry point now mounts the root component and gives its view
tree the configured desktop layout size, but `StandaloneViewManager` still
records views without drawing them. The
SnapDrawing C++ core builds on Linux, but the checked-in Linux bootstrap has
no production X11/Wayland view or GPU presentation backend. Thus the current
Android `GLSurfaceView` cannot simply be rebuilt as a Linux desktop view.

An opt-in SDL2 host builds a separate Linux window target. It mounts the Valdi
component in the same process, feeds window resizes into Valdi layout, and
pumps SDL events alongside Valdi's main queue. The repository's Bazel settings
select Hermes for this Linux build, which is the JavaScript engine needed for
the planned JSI WebGPU binding. Install SDL2 development headers and libraries,
then run it from a Wayland session:

```sh
bazel build //apps/three_native:three_native_linux_window
SDL_VIDEODRIVER=wayland bazel-bin/apps/three_native/three_native_linux_window
```

The window currently shows a diagnostic canvas. The native Valdi view tree and
Three/Dawn scene are not yet composited into it. The existing `three_native_linux`
target remains available for headless component execution.
Set `VALDI_LINUX_TRACE_VIEWS=1` to log the laid out view tree after startup.
On the Linux demo host, it reported a 600×800 `UIView` carrying the platter's
78,048-byte `meshBytes` buffer, confirming the component and scene graph ran
through Valdi's JavaScript and native attribute path.

The app-specific `three_native_linux_gl` target now presents that Valdi scene
in its own native SDL2 window using an OpenGL ES 3 context. It reads the same
`meshBytes` and `transformBytes` custom-view attributes as the Android GLES3
adapter, uploads the static mesh once, and updates the model matrices as Valdi
rerenders. SDL resizes update Valdi layout; mouse drags call the component's
`onDrag` callback. Install SDL2 and GLES development headers and libraries:

```sh
bazel build //apps/three_native:three_native_linux_gl
SDL_VIDEODRIVER=wayland bazel-bin/apps/three_native/three_native_linux_gl
```

Press Escape or close the window to exit. For a bounded run and a GPU readback
of the 100th rendered scene frame:

```sh
THREE_NATIVE_LINUX_CAPTURE=/tmp/valdi-platter.ppm \
THREE_NATIVE_LINUX_CAPTURE_FRAME=100 \
SDL_VIDEODRIVER=wayland \
  bazel-bin/apps/three_native/three_native_linux_gl --frames=120
```

The Intel Linux Wayland host rendered 120 frames and saved a 600×800 image with
320 distinct RGB colors. It uploaded the 78,048-byte mesh once and observed 42
matrix changes. The `--drag-test --frames=80` diagnostic also passed, confirming
SDL mouse events reached Valdi and changed the model transform. This GLES3
adapter is a narrow presentation path for the platter; it does not expose
WebGL or WebGPU to Three's renderer.

On rolling-release Linux distributions, the pinned LLVM and Swift host tools
may require `libxml2.so.2` and `libncurses.so.6`. If the distribution only
provides newer sonames, supply compatible libraries and pass their directory
to Bazel with both `--action_env=LD_LIBRARY_PATH=...` and
`--host_action_env=LD_LIBRARY_PATH=...`. This affects the build tools, not the
Valdi app itself.

The [Linux Dawn probes](linux_dawn_probe/README.md) now run the same platter
through Three r186's **actual `WebGPURenderer`**, Dawn/Vulkan and the Intel GPU
on the Linux demo host. The direct probe presents to either an Xwayland or a
native Wayland swapchain, including its glass material, typed-array texture
upload and a targeted render-target readback. The native Wayland path uses
rebuilt SDL and Dawn addons and ran 1,000 WorldOS scene frames with forced
garbage collection. A separate host uses the current official Dawn C API to
validate native Wayland presentation without Three. The Three renderer is not
yet connected to Valdi's Hermes runtime.
The direct probe can also load WorldOS's actual painted-grid TSL material and
shared scene factories from a SPAOS checkout, animating its lattice wave and hover
state beside the authored platter GLB. It uses WorldOS's own rounded tile
geometry with a simple physical material in place of the full tile shader;
the assembled WorldOS shell is not running in this host. A second `--world-home`
mode loads six real textured WorldOS app icon GLBs and the Files box into their
home positions. It renders through Dawn's native Wayland swapchain and captures a GPU frame,
but the layout is a pinned snapshot and the jar, stack paper, HUD and live shell
state are still missing.

For a native Linux desktop version, keep the Valdi/Three scene and GLB loader;
add a Linux window and input/lifecycle host, a GPU swapchain/surface, and a
native JS-to-GPU binding for Three's renderer. SnapDrawing can serve as the 2D
UI layer if a Linux platform host is added. It does not supply Three's WebGL 2
or WebGPU API. For the full World OS renderer, the preferred shared 3D path to
evaluate is Dawn/WebGPU over Vulkan on Linux and Android, Metal on iOS; a
WebGL 2 bridge over EGL/GLES is an alternative. The current triangle adapter
is a demonstrated first slice, not either complete renderer binding.

## Compatibility and next work

The original GLB bytes and Three r186 loader/scene graph need no conversion.
The visual material is a fixed lit blue shader; the original World OS material
pipeline is not yet supported. Current adapter supports one mesh expanded to
triangles with positions and normals. It excludes textures, morph targets, skinning,
multiple meshes/materials, lights, scene render targets and GLSL/TSL shaders.

Priority for the reusable runtime:

1. Adapt a current Dawn/WebGPU JSI binding to Valdi's Hermes runtime and JS
   scheduler, and connect it to the verified native Wayland `WGPUSurface`.
2. Connect a Valdi Linux view renderer and Dawn surface to the WebGPU binding,
   replacing the narrow GLES3 platter adapter for full Three scenes.
3. Expand browser API compatibility and validate a representative WorldOS
   shader scene and its materials, textures, and readback paths.
4. Reuse the WebGPU binding on Android and iOS, with Vulkan and Metal surfaces
   and shared lifecycle tests. Measure native call and frame costs on hardware.

The Linux Bazel build of `//valdi:valdi_hermes` already defines `HERMES_API`,
so its Hermes runtime has a JSI instance. The remaining Valdi seam is to expose
that instance on the owning JS thread and install a WebGPU binding before Three
loads. The upstream [React Native WebGPU](https://github.com/wcandillon/react-native-webgpu)
C++ API wrappers (inspected at `e2735d7`) are a candidate, but its manager
expects a React `CallInvoker` and a platform context. A Linux Valdi adapter
must supply the scheduler, Dawn surface ownership, and image decoding. The
native scene probe validates the Linux surface and a first JPEG/WebP decode
path independently of that binding.

World OS's asset licensing is unresolved; this local prototype is not intended
for distribution.
