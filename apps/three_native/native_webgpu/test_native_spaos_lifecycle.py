#!/usr/bin/env python3
"""End-to-end native World restart under an isolated nested SPAOS session.

Requires a running host Wayland compositor, such as a separate headless Sway.
Only the compositor started by this test and its World child are stopped.
"""

import argparse
import json
import os
import re
import secrets
import shlex
import signal
import socket
import subprocess
import tempfile
import time
from pathlib import Path


def lifecycle_request(path: Path, token: str, request: dict) -> dict:
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(5)
        client.connect(str(path))
        client.sendall((json.dumps({"token": token, "request": request}) + "\n").encode())
        response = client.makefile().readline()
    if not response:
        raise RuntimeError("SPAOS lifecycle connection closed without a response")
    return json.loads(response)


def wait_for_restart(process: subprocess.Popen, endpoint: Path, token: str) -> dict:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"SPAOS exited during native World restart: {process.returncode}")
        try:
            status = lifecycle_request(endpoint, token, {"op": "status"})
        except (FileNotFoundError, ConnectionRefusedError):
            time.sleep(.2)
            continue
        if not status.get("ok"):
            raise RuntimeError(f"SPAOS lifecycle status failed: {status}")
        jobs = status.get("jobs", [])
        if jobs:
            if len(jobs) != 1 or jobs[0]["action"] != "restart" or jobs[0]["target"] != "world":
                raise RuntimeError(f"Unexpected lifecycle jobs: {jobs}")
            if jobs[0]["phase"] == "failed":
                raise RuntimeError(f"World restart failed: {jobs[0]}")
            if jobs[0]["phase"] == "succeeded":
                if not status["targets"]["world"]["ready"]:
                    raise RuntimeError("Replacement World was not ready")
                return status
        time.sleep(.25)
    raise TimeoutError("Native World did not complete its SPAOS restart")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spaos", type=Path, help="spaos-compositor binary")
    parser.add_argument("world", type=Path, help="native Valdi WebGPU host binary")
    parser.add_argument("bundle", type=Path, help="bundled three_world_home.js")
    parser.add_argument("assets", type=Path, help="prepared native asset directory")
    parser.add_argument("--state", type=Path, help="optional read-only WorldOS world.json")
    args = parser.parse_args()
    runtime_parent = os.environ.get("XDG_RUNTIME_DIR")
    host_display = os.environ.get("WAYLAND_DISPLAY")
    if not runtime_parent or not host_display:
        parser.error("XDG_RUNTIME_DIR and WAYLAND_DISPLAY must name an isolated host display")
    for name in ("spaos", "world", "bundle", "assets"):
        if not getattr(args, name).exists():
            parser.error(f"{name} does not exist: {getattr(args, name)}")

    with tempfile.TemporaryDirectory(prefix="valdi-spaos-lifecycle-", dir=runtime_parent) as directory:
        runtime = Path(directory)
        token = secrets.token_urlsafe(48)
        endpoint = runtime / "lifecycle.sock"
        first_bundle = runtime / "first-world.js"
        first_bundle.write_bytes(
            b'setTimeout(() => { console.log("native SPAOS restart", globalThis.__worldRestart()); }, 3000);\n'
            + args.bundle.read_bytes()
        )
        wrapper = runtime / "run-world.sh"
        wrapper.write_text("#!/usr/bin/env bash\nset -euo pipefail\n"
            f"if mkdir {shlex.quote(str(runtime / 'first-launch'))} 2>/dev/null; then\n"
            f"  bundle={shlex.quote(str(first_bundle))}\n"
            "else\n"
            f"  bundle={shlex.quote(str(args.bundle.resolve()))}\n"
            "fi\n"
            f"exec {shlex.quote(str(args.world.resolve()))} --interactive \"$bundle\"\n")
        wrapper.chmod(0o700)
        environment = os.environ.copy()
        environment.update(
            XDG_CONFIG_HOME=str(runtime / "config"),
            XDG_DATA_HOME=str(runtime / "data"),
            SPAOS_WORLD_OS_X11="0",
            SPAOS_AGENT_SERVICE="0",
            SPAOS_LIFECYCLE_SOCKET=str(endpoint),
            SPAOS_LIFECYCLE_TOKEN=token,
            WORLD_OS_NATIVE_ASSETS=str(args.assets.resolve()),
            SDL_VIDEODRIVER="wayland",
        )
        if args.state:
            environment["WORLD_OS_NATIVE_STATE"] = str(args.state.resolve())
        else:
            environment.pop("WORLD_OS_NATIVE_STATE", None)
        socket_name = f"wayland-valdi-life-{os.getpid()}-{secrets.token_hex(3)}"
        log_path = runtime / "session.log"
        with log_path.open("wb") as log:
            process = subprocess.Popen(
                [str(args.spaos.resolve()), "--socket", socket_name, "--session",
                 "--no-shell", "--world-command", str(wrapper)],
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                status = wait_for_restart(process, endpoint, token)
                text = re.sub(r"\x1b\[[0-9;]*m", "", log_path.read_text(errors="replace"))
                pids = re.findall(r"world started\s+pid=(\d+)", text)
                if len(set(pids)) < 2:
                    raise RuntimeError(f"Expected two distinct World processes; saw {pids}")
                if "native SPAOS restart true" not in text:
                    raise RuntimeError("Native World did not report a successful restart request")
                print(f"SPAOS native World restart passed: {pids[0]} -> {pids[-1]}")
                print(f"Lifecycle job: {status['jobs'][0]['phase']} ({status['jobs'][0]['message']})")
            except Exception:
                print("SPAOS test log tail:\n" + log_path.read_text(errors="replace")[-5000:])
                raise
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)


if __name__ == "__main__":
    main()
