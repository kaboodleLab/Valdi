#!/usr/bin/env python3
"""Exercise the Linux World host's real inherited SPAOS channel and GPU frame."""

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
        raise SystemExit("usage: test_native_world_lifecycle.py BINARY WORLD_JS ASSETS")
    if not os.environ.get("WAYLAND_DISPLAY") or not os.environ.get("XDG_RUNTIME_DIR"):
        raise SystemExit("An isolated Wayland display is required")

    binary, bundle, assets = sys.argv[1:]
    with tempfile.TemporaryDirectory(prefix="valdi-world-lifecycle-") as directory:
        scripted = Path(directory) / "world.js"
        scripted.write_bytes(
            b"setTimeout(() => globalThis.__worldRestart(), 2500);\n"
            + Path(bundle).read_bytes()
        )
        parent, child = socket.socketpair()
        environment = os.environ.copy()
        environment["WORLD_OS_NATIVE_ASSETS"] = assets
        environment["SPAOS_APP_CHANNEL_FD"] = str(child.fileno())
        environment["SDL_VIDEODRIVER"] = "wayland"
        process = subprocess.Popen(
            [binary, "--interactive", str(scripted)],
            env=environment,
            pass_fds=(child.fileno(),),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        child.close()
        parent.setblocking(False)
        received = b""
        types = []
        floor_sent = False
        revealed_space = False
        revealed_window = False
        deadline = time.monotonic() + 40
        try:
            while time.monotonic() < deadline:
                readable, _, _ = select.select([parent], [], [], 1)
                if not readable:
                    if process.poll() is not None:
                        raise RuntimeError(f"World exited before restart: {process.returncode}")
                    continue
                data = parent.recv(65536)
                if not data:
                    raise RuntimeError("World channel closed before lifecycle quit")
                received += data
                while b"\n" in received:
                    line, received = received.split(b"\n", 1)
                    message = json.loads(line)
                    types.append(message.get("type"))
                    if message.get("type") == "lifecycle_ready" and not floor_sent:
                        floor_sent = True
                        floor = {"type": "spaces", "spaces": [{
                            "id": 1, "active": True, "windows": 1,
                            "at": {"x": 5, "z": 0},
                            "seats": [{"window": 9, "x": 0, "y": 0, "w": 200, "h": 100}],
                        }]}
                        parent.sendall((json.dumps(floor) + "\n").encode())
                    if message.get("type") == "reveal_windows" and message.get("space") == 1:
                        if message.get("window") == 9:
                            revealed_window = True
                        elif "window" not in message:
                            revealed_space = True
                    if message.get("type") != "lifecycle":
                        continue
                    request = message["request"]
                    if request["op"] == "status":
                        result = {"ok": True, "session": "session-1",
                                  "targets": {"world": {"ready": True}}}
                    elif request["op"] == "submit":
                        if (request.get("target"), request.get("action"),
                                request.get("session")) != ("world", "restart", "session-1"):
                            raise RuntimeError(f"unexpected restart request: {request}")
                        result = {"ok": True, "session": "session-1"}
                    else:
                        raise RuntimeError(f"unexpected lifecycle request: {request}")
                    response = {"type": "lifecycle_result", "id": message["id"],
                                "result": result}
                    parent.sendall((json.dumps(response) + "\n").encode())
                    if request["op"] == "submit":
                        parent.sendall(b'{"type":"lifecycle_quit"}\n')
                        process.wait(timeout=10)
                        output, errors = process.communicate()
                        if process.returncode != 0:
                            raise RuntimeError(f"World exit {process.returncode}: {errors}")
                        if types.count("hello") != 1 or types.count("lifecycle_ready") != 1 \
                                or types.count("lifecycle") != 2:
                            raise RuntimeError(f"unexpected channel sequence: {types}")
                        if not revealed_space or not revealed_window:
                            raise RuntimeError(f"mapped floor was not revealed: {types}")
                        print("native World lifecycle passed:", types)
                        print(output.strip())
                        return
            raise TimeoutError(f"World lifecycle timed out: {types}")
        finally:
            parent.close()
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()
