#!/usr/bin/env bash
# Build and exercise the real Linux desktop host; run from any working directory.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ $(uname -s) != Linux ]]; then
  echo "Linux desktop smoke requires Linux; portable model tests can run separately."
  exit 0
fi
: "${WAYLAND_DISPLAY:?Select the Wayland session to test}"
: "${XDG_RUNTIME_DIR:?Select the session user runtime directory}"
bazel_cmd=${BAZEL:-bazel}
flags=()
if [[ -n ${LD_LIBRARY_PATH:-} ]]; then
  flags+=(--action_env=LD_LIBRARY_PATH
    "--@rules_rust//rust/settings:extra_exec_rustc_env=LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
    "--@rules_rust//rust/settings:extra_rustc_env=LD_LIBRARY_PATH=$LD_LIBRARY_PATH")
fi
"$bazel_cmd" build --jobs=6 "${flags[@]}" //apps/linux_notes:notes //valdi:test_linux_bin //snap_drawing:test
node --experimental-strip-types apps/linux_notes/tests/model.test.mjs
bazel-bin/valdi/test_linux_bin --gtest_filter='LinuxRuntime.*:LinuxDocumentStoreTest.*'
bazel-bin/snap_drawing/test --gtest_filter='TextCaretTest.*:WordCachingTextShaperTest.*:TextShaperCache.*'
probe=$(mktemp -d /tmp/valdi-linux-smoke-XXXXXX)
trap 'rm -rf "$probe"' EXIT
output=${VALDI_LINUX_SMOKE_OUTPUT:-$probe}
mkdir -p "$output"
export SDL_VIDEO_DRIVER=wayland
font_args=()
if [[ -n ${VALDI_LINUX_FALLBACK_FONT:-} ]]; then font_args+=(--fallback-font "$VALDI_LINUX_FALLBACK_FONT"); fi
"$bazel_cmd" run "${flags[@]}" //apps/linux_notes:notes -- --state-dir "$probe" "${font_args[@]}" \
  --smoke-test --screenshot "$output/edited.png" --content-snapshot "$output/edited.json"
"$bazel_cmd" run "${flags[@]}" //apps/linux_notes:notes -- --state-dir "$probe" "${font_args[@]}" \
  --smoke-reopen --screenshot "$output/reopened.png" --content-snapshot "$output/reopened.json"
python3 - "$output/edited.png" "$output/reopened.png" <<'PY_CHECK'
import json, pathlib, struct, sys
for filename in sys.argv[1:]:
    data = pathlib.Path(filename).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) > 100
    width, height = struct.unpack(">II", data[16:24])
    assert width > 300 and height > 200, (filename, width, height)
    packet = json.loads(pathlib.Path(filename).with_suffix('.json').read_text())
    assert packet['schema'] == 'spaos.content.experimental/1' and len(packet['nodes']) == 6
    editor = next(node for node in packet['nodes'] if node['role'] == 'text-input')
    text = editor['text']
    assert text['preview'] == 'Hello Linux! مرحبا — 日本語'
    assert isinstance(text['cursor'], int) and text['cursor'] == text['length'] == text['anchor']
    assert text['caret'] is not None and text['caret'][3] > 0
    assert 0 <= text['caret'][0] <= packet['extent'][0]
PY_CHECK
echo "Linux desktop edit, save, undo, resize and reopen passed."
if [[ -n ${VALDI_LINUX_SMOKE_OUTPUT:-} ]]; then echo "Evidence: $output"; fi
