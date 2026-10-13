# Valdi Linux desktop prototype

This experiment connects Valdi's real SnapDrawing view manager to an SDL3 native window.
Set `SDL_VIDEO_DRIVER=wayland` to require Wayland. It uses software rasterisation; Chromium
and an app HTTP server are absent. The existing headless Linux entry point is unchanged.

The Notes app exercises TypeScript state, Unicode grapheme editing, selection by keyboard,
undo/redo, clipboard, scrolling, resize and a private persistent document. The editor is an
app-owned experimental component, not a completed port of native `textfield`/`textview`.

## Build and run the prototype

Install the development headers and libraries for SDL3 and Fontconfig. On Arch, these are
provided by `sdl3` and `fontconfig`. The Bazel extension declares the installed SDK
headers explicitly. Use the repository's pinned Bazel version through Bazelisk.

```sh
bazel build --jobs=6 //apps/linux_notes:notes //valdi:test_linux_bin
node --experimental-strip-types apps/linux_notes/tests/model.test.mjs
mkdir -m 700 -p "$HOME/.local/state/valdi-linux-notes"
SDL_VIDEO_DRIVER=wayland bazel run //apps/linux_notes:notes -- \
  --state-dir "$HOME/.local/state/valdi-linux-notes"
```

The display socket must name the selected session, e.g. `WAYLAND_DISPLAY=spaos-tty1` with
`XDG_RUNTIME_DIR=/run/user/1000` on the verified local SPAOS machine. Do not replace the
running desktop to launch this experiment. A directly launched native window is placed in an
ordinary space while World remains on its floor. Use Super+1 to enter space 1 for this test;
the app should not mark itself as privileged shell content just to appear above World.

Valdi's bundled LLVM linker currently needs `libxml2.so.2`. If an Arch host only has the newer
ABI, a signed `libxml2-legacy` package can be extracted into a task-local directory and that
`usr/lib` passed through `LD_LIBRARY_PATH`, Bazel's `--action_env=LD_LIBRARY_PATH`, and
`rules_rust`'s `extra_exec_rustc_env` / `extra_rustc_env` settings (the smoke script supplies all
three when `LD_LIBRARY_PATH` is set). The
compatibility library is a build prerequisite, not a reason to downgrade the machine's XML
library. Swift also expects `libncurses.so.6`; on this Arch host a task-local alias to the
installed `libncursesw.so.6` lets the compiler run. Record the package version and verification when supplying it this way.

## Verify the behavior

`apps/linux_notes/smoke.sh` builds the native application and focused Linux tests,
runs the portable editor tests, then opens the actual Wayland window twice with temporary
private state. It exercises edit, save, deletion, undo and resize; the second launch checks
that the TypeScript app loaded the saved document. Each launch writes a PNG from the same
raster canvas sent to the window. Set `VALDI_LINUX_SMOKE_OUTPUT` to retain that evidence.

Keyboard commands: Ctrl+A selects all; Shift+Left/Right extends selection; Ctrl+C/X/V uses
the clipboard; Ctrl+S saves; Ctrl+Z/Shift+Ctrl+Z undoes/redoes. Home and End currently move to
document boundaries. Selection uses attributed-text highlighting; the caret is a visible text marker in this first experiment.

## Local verification on 13 October 2026

The prototype was built from Valdi base `41f35ae3b27aeb8a2cf4c45f8ca3ab57da8b5202` and
tested on the selected local SPAOS machine at `10.65.0.126`, tty1, without replacing its
running desktop. Bazel 8.2.1, SDL3 3.4.16 and Fontconfig 2.18.3 were used.

- Portable model checks passed for emoji clusters, combining marks, selection, deletion and undo/redo.
- Four existing Linux runtime tests and two private-document regressions passed.
- Both Wayland smoke launches passed, with PNGs for the edited and reopened app.
- A compositor screenshot confirmed the window in space 1. Real virtual-keyboard input and
  Ctrl+S reached the app and its private persistent file. Real keyboard copy/paste round-tripped
  the complete Unicode note; undo restored its saved hash. Pointer clicks on Save also persisted
  an edit and its undo.
- The debug-built live process measured approximately 191 MiB RSS. Memory, input latency and
  frame pacing have not been benchmarked against a production target.

Build compatibility used a task-local, Arch-keyring-verified `libxml2-legacy` 2.13.9-2
package and an alias for the installed ncurses library. CJK fallback used
`NotoSansCJKjp-Regular.otf` from [Noto CJK](https://github.com/notofonts/noto-cjk), revision
`f8d157532fbfaeda587e826d4cd5b21a49186f7c`, SHA-256
`68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5`.
The font and compatibility tools are not committed or installed globally.

This smoke script is an opt-in local probe requiring a selected Wayland session. A graphical
CI job and broader mobile/web regression coverage remain to add before proposing an upstream
Linux desktop support claim.

## Boundaries and remaining work

- This is an unsandboxed development host, launched directly. It is not an installed SPAOS app.
  Production packaging and appd launch must supply the app's private state directory and grants.
- The document adapter exposes one fixed private document and accepts no script-provided filesystem paths. Writes are bounded
  to 1 MiB, synced and atomically renamed; non-private directories and symlink reads are refused.
  SQLite, migrations, encryption and multiplayer are separate follow-ups.
- Clipboard calls currently use SDL. A SPAOS adapter must route host actions through the shared
  capability contracts; this compatibility behavior is not the platform's authority design.
- Composition events reach the app, but caret tracking for IME candidates, pointer selection,
  visual up/down navigation, full focus navigation and native editor parity remain to implement.
- Rendering currently runs on the event thread, with timed animation refreshes. Idle work wakes
  through SDL when Valdi enqueues a task. GPU surfaces, explicit fences and compositor pacing are
  subsequent milestones.
- The app publishes a state snapshot for the smoke probe. This is not a rich semantic tree or a
  versioned SPAOS presentation protocol. Native components, independent panels and spatial
  objects still need the shared contract and text/component adapters.
- System fonts are discovered through Fontconfig. A host-selected `--fallback-font FILE` can
  supply a bundled font without installing it system-wide; the smoke command accepts
  `VALDI_LINUX_FALLBACK_FONT`. Deterministic font selection and shared SPAOS
  text-stack integration remain to prove.

Filament is not part of this first prototype. Before adding a 3D renderer, define the versioned
surface, semantic and spatial-object contract with the compositor, then replace this raster
presentation adapter with the agreed buffer and synchronization path.
