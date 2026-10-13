# Viewless spatial kit adapter

This Linux development host runs TypeScript in Valdi and exchanges bounded component snapshots
and local events with SPAOS's shared Rust-kit experiment. It creates no Valdi component or
SnapDrawing view tree. The host owns lifetime through its input pipe; it initializes the
standalone JS environment without `evalScript`'s automatic idle exit coordinator.

Build `//apps/linux_spatial_kit:host` with the same pinned Bazel and task-local prerequisites as
`apps/linux_notes/README.md`. The canonical TypeScript files are in SPAOS's
`desktop/spatial/experiments/spatial-kit/ts/`; these three copies must match. Its `compare.mjs`
checks their SHA-256 hashes and tests nine states against the thin adapter and shared Rust renderer.

This is a language/runtime proof, not a port of Valdi UI components, a production SPAOS app,
or a claim of mobile/web compatibility for the new kit. It opens no listener and exposes no
filesystem, network, clipboard or system-setting action to script. JSON descriptions cross the
host boundary on the callback thread; the Rust kit owns validation, text, layout and input geometry.
The SPAOS experiment's README contains exact launch and comparison commands.
