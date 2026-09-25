# Valdi + Three.js native Android slice

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
The vendored Three r186 modules are lowered to ES2018 for Valdi's minifier;
this module uses Valdi's `js` compilation mode because its Android release
bytecode precompiler does not accept these modules.

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

### Device validation still required

No Android device or emulator was attached during development. With an arm64
GLES 3 device connected, use:

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

Watch the platter rotate before and after the swipe, rotate the device to
exercise resize, and check that it redraws after returning from Home. Record
frame time and JavaScript-to-Java copy cost on the device; the host benchmark
does not measure either of those paths.

## Compatibility and next work

The original GLB bytes and Three r186 loader/scene graph need no conversion.
The visual material is a fixed lit blue shader; the original World OS material
pipeline is not yet supported. Current adapter supports one static indexed
mesh with positions and normals. It excludes textures, morph targets, skinning,
multiple meshes/materials, lights, scene render targets and GLSL/TSL shaders.

Priority for the reusable runtime:

1. Complete an Android device validation with screenshots, lifecycle and touch
   checks; measure the JavaScript render and JNI copy cost on device.
2. Port Expo GL's WebGL 2 host surface and methods into Valdi's JS runtime so
   Three's existing WebGL backend can run, including image/texture loading.
3. Bring up a representative World OS shader scene and compare frame time and
   visual output with the desktop renderer.
4. Evaluate the React Native WebGPU Dawn layer against Valdi's JS engine and
   Three's `Backend` contract. If adopted, use Metal on iOS and Vulkan on
   Android, with one shared resource-lifetime test suite.

World OS's asset licensing is unresolved; this local prototype is not intended
for distribution.
