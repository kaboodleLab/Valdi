#!/usr/bin/env python3
"""Verify native launcher search sends the selected app over SPAOS's World channel."""

import json
import os
import select
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: test_native_app_search.py BINARY WORLD_JS ASSETS")
    if not os.environ.get("WAYLAND_DISPLAY") or not os.environ.get("XDG_RUNTIME_DIR"):
        raise SystemExit("An isolated Wayland display is required")
    binary, bundle, assets = sys.argv[1:]
    with tempfile.TemporaryDirectory(prefix="valdi-app-search-") as directory:
        scripted = Path(directory) / "world.js"
        scripted.write_bytes(
            b"function searchApp() {\n"
            b"  if (typeof globalThis.__worldTextInput !== 'function') return setTimeout(searchApp, 100);\n"
            b"  __worldTextInput('calc');\n"
            b"  __worldNavigate('enter');\n"
            b"}\nsetTimeout(() => __worldPointer(674, 674, true), 1000);\n"
            b"setTimeout(searchApp, 2500);\n"
            + Path(bundle).read_bytes()
        )
        parent, child = socket.socketpair()
        environment = os.environ.copy()
        environment["WORLD_OS_NATIVE_ASSETS"] = assets
        environment["SPAOS_APP_CHANNEL_FD"] = str(child.fileno())
        environment["SDL_VIDEODRIVER"] = "wayland"
        process = subprocess.Popen(
            [binary, "--frames=240", str(scripted)],
            env=environment,
            pass_fds=(child.fileno(),),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        child.close()
        parent.setblocking(False)
        pending = b""
        received = []
        catalog = {"type": "apps", "apps": [
            {"key": "browser", "name": "Browser"},
            {"key": "calendar", "name": "Calendar"},
            {"key": "calculator", "name": "Calculator"},
        ]}
        deadline = time.monotonic() + 40
        try:
            while time.monotonic() < deadline:
                ready, _, _ = select.select([parent], [], [], .5)
                if ready:
                    chunk = parent.recv(65536)
                    if not chunk:
                        break
                    pending += chunk
                    while b"\n" in pending:
                        line, pending = pending.split(b"\n", 1)
                        message = json.loads(line)
                        received.append(message)
                        if message.get("type") == "hello":
                            parent.sendall((json.dumps(catalog) + "\n").encode())
                        if message.get("type") == "open":
                            if message.get("app") != "calculator":
                                raise RuntimeError(f"Search launched the wrong app: {message}")
                            process.wait(timeout=15)
                            output, errors = process.communicate()
                            if process.returncode != 0:
                                raise RuntimeError(f"Native World exit {process.returncode}: {errors}")
                            if "launcher search: calc (1 apps)" not in errors:
                                raise RuntimeError(f"Filtered launcher did not report one match: {errors}")
                            print("Native launcher search passed: calculator selected from 3 apps")
                            print(output.strip())
                            return
                if process.poll() is not None:
                    break
            output, errors = process.communicate(timeout=5)
            raise RuntimeError(f"No app open request; channel={received}; output={output}; errors={errors}")
        finally:
            parent.close()
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()
