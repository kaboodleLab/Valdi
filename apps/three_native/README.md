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
target, but its entry point runs `ValdiStandaloneRuntime::evalScript` and
`StandaloneViewManager`; it does not create a Linux display window. The
SnapDrawing C++ core builds on Linux, but the checked-in Linux bootstrap has
no X11/Wayland window, event, or GPU presentation backend. Thus the current
Android `GLSurfaceView` cannot simply be rebuilt as a Linux desktop view.

The [Linux Dawn probes](linux_dawn_probe/README.md) now run the same platter
through Three r186's **actual `WebGPURenderer`**, Dawn/Vulkan and the Intel GPU
on `192.168.1.41`. One probe presents the Three scene directly to an Xwayland
swapchain, including its glass material, typed-array texture upload and a
targeted render-target readback. A second host uses the current official Dawn
C API to present directly to GNOME Wayland. These are separate programs; the
Three renderer is not yet connected to Valdi or the native Wayland host.

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
pipeline is not yet supported. Current adapter supports one static indexed
mesh with positions and normals. It excludes textures, morph targets, skinning,
multiple meshes/materials, lights, scene render targets and GLSL/TSL shaders.

Priority for the reusable runtime:

1. Adapt a current Dawn/WebGPU JSI binding to Valdi's Hermes runtime and JS
   scheduler, and connect it to the verified native Wayland `WGPUSurface`.
2. Add a Valdi Linux window/input host and run the platter in that runtime.
3. Expand browser API compatibility and validate a representative WorldOS
   shader scene and its materials, textures, and readback paths.
4. Reuse the WebGPU binding on Android and iOS, with Vulkan and Metal surfaces
   and shared lifecycle tests. Measure native call and frame costs on hardware.

World OS's asset licensing is unresolved; this local prototype is not intended
for distribution.
