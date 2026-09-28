#!/usr/bin/env python3
"""Verify SPAOS replaces native Space UI after a GPU frame and retains World."""

import argparse
import json
import os
import re
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import tempfile
import time
from pathlib import Path


def request(endpoint: Path, token: str, body: dict) -> dict:
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(5)
        client.connect(str(endpoint))
        client.sendall((json.dumps({"token": token, "request": body}) + "\n").encode())
        response = client.makefile().readline()
    if not response:
        raise RuntimeError("SPAOS lifecycle socket closed without a response")
    return json.loads(response)


def wait_for_status(process: subprocess.Popen, endpoint: Path, token: str,
                    predicate, timeout: float = 45) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"SPAOS exited during Shell lifecycle test: {process.returncode}")
        try:
            status = request(endpoint, token, {"op": "status"})
        except (FileNotFoundError, ConnectionRefusedError):
            time.sleep(.25)
            continue
        if not status.get("ok"):
            raise RuntimeError(f"SPAOS lifecycle status failed: {status}")
        if predicate(status):
            return status
        time.sleep(.25)
    raise TimeoutError("SPAOS Shell lifecycle state did not become ready")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spaos", type=Path, help="SPAOS compositor binary")
    parser.add_argument("native", type=Path, help="Valdi WebGPU host binary")
    parser.add_argument("world_bundle", type=Path)
    parser.add_argument("shell_bundle", type=Path)
    parser.add_argument("assets", type=Path)
    parser.add_argument("controller", type=Path, help="bundled native Space UI controller")
    parser.add_argument("desktop", type=Path, help="SPAOS desktop root")
    parser.add_argument("electron", type=Path, help="installed app runtime binary")
    parser.add_argument("--state", type=Path, help="optional read-only WorldOS world.json")
    args = parser.parse_args()
    runtime_parent = os.environ.get("XDG_RUNTIME_DIR")
    host_display = os.environ.get("WAYLAND_DISPLAY")
    node = shutil.which("node")
    if not runtime_parent or not host_display or not node:
        parser.error("XDG_RUNTIME_DIR, WAYLAND_DISPLAY and Node are required")
    for name in ("spaos", "native", "world_bundle", "shell_bundle", "assets", "controller", "desktop", "electron"):
        if not getattr(args, name).exists():
            parser.error(f"{name} does not exist: {getattr(args, name)}")

    with tempfile.TemporaryDirectory(prefix="valdi-spaos-shell-", dir=runtime_parent) as directory:
        runtime = Path(directory)
        endpoint = runtime / "lifecycle.sock"
        token = secrets.token_urlsafe(48)
        world_wrapper = runtime / "run-world.sh"
        world_wrapper.write_text("#!/usr/bin/env bash\nset -euo pipefail\n"
            f"exec {shlex.quote(str(args.native.resolve()))} --interactive "
            f"{shlex.quote(str(args.world_bundle.resolve()))}\n")
        world_wrapper.chmod(0o700)
        shell_wrapper = runtime / "run-shell.sh"
        shell_wrapper.write_text("#!/usr/bin/env bash\nset -euo pipefail\n"
            f"exec {shlex.quote(node)} {shlex.quote(str(args.controller.resolve()))}\n")
        shell_wrapper.chmod(0o700)
        environment = os.environ.copy()
        environment.update(
            XDG_CONFIG_HOME=str(runtime / "config"),
            XDG_DATA_HOME=str(runtime / "data"),
            SPAOS_WORLD_OS_X11="0",
            SPAOS_AGENT_SERVICE="0",
            SPAOS_LIFECYCLE_SOCKET=str(endpoint),
            SPAOS_LIFECYCLE_TOKEN=token,
            SPAOS_DESKTOP_ROOT=str(args.desktop.resolve()),
            SPAOS_ELECTRON_BINARY=str(args.electron.resolve()),
            VALDI_SHELL_BINARY=str(args.native.resolve()),
            VALDI_SHELL_BUNDLE=str(args.shell_bundle.resolve()),
            WORLD_OS_NATIVE_ASSETS=str(args.assets.resolve()),
            SDL_VIDEODRIVER="wayland",
        )
        appd = args.desktop / "target/release/spaos-appd"
        if appd.is_file():
            environment["SPAOS_APPD_BIN"] = str(appd)
        if args.state:
            environment["WORLD_OS_NATIVE_STATE"] = str(args.state.resolve())
        else:
            environment.pop("WORLD_OS_NATIVE_STATE", None)
        socket_name = f"wayland-valdi-shell-{os.getpid()}-{secrets.token_hex(3)}"
        log_path = runtime / "session.log"
        with log_path.open("wb") as log:
            process = subprocess.Popen(
                [str(args.spaos.resolve()), "--socket", socket_name, "--session",
                 "--world-command", str(world_wrapper), "--shell-command", str(shell_wrapper)],
                env=environment, stdin=subprocess.DEVNULL, stdout=log,
                stderr=subprocess.STDOUT, start_new_session=True,
            )
            try:
                before = wait_for_status(process, endpoint, token,
                    lambda status: status["targets"]["world"]["ready"] and
                    status["targets"]["shell"]["ready"])
                identity = secrets.token_hex(16)
                submitted = request(endpoint, token, {"op": "submit", "session": before["session"],
                    "request_id": identity, "target": "shell", "action": "restart"})
                if not submitted.get("ok"):
                    raise RuntimeError(f"SPAOS refused Shell restart: {submitted}")
                after = wait_for_status(process, endpoint, token,
                    lambda status: any(job["id"] == identity and
                        job["phase"] in ("succeeded", "failed") for job in status["jobs"]))
                job = next(job for job in after["jobs"] if job["id"] == identity)
                if job["phase"] != "succeeded" or not after["targets"]["shell"]["ready"] or \
                        not after["targets"]["world"]["ready"]:
                    raise RuntimeError(f"SPAOS did not replace only Shell: {after}")
                output = re.sub(r"\x1b\[[0-9;]*m", "", log_path.read_text(errors="replace"))
                world_pids = re.findall(r"world started\s+pid=(\d+)", output)
                shell_pids = re.findall(r"shell started\s+pid=(\d+)", output)
                if len(world_pids) != 1 or len(set(shell_pids)) != 2:
                    raise RuntimeError(f"Unexpected replacement processes: World {world_pids}, Shell {shell_pids}")
                frames = [match.start() for match in re.finditer("Native Space UI first frame presented", output)]
                ready = [match.start() for match in re.finditer("native Space UI frame presented; Shell lifecycle ready", output)]
                if len(frames) != 2 or len(ready) != 2 or any(a >= b for a, b in zip(frames, ready)):
                    raise RuntimeError("Shell readiness did not follow each native GPU frame")
                print(f"SPAOS Shell restart passed: {shell_pids[0]} -> {shell_pids[-1]}; World {world_pids[0]} retained")
                print(f"Lifecycle job: {job['phase']} ({job['message']})")
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
        for leftover in (Path(runtime_parent) / socket_name,
                         Path(runtime_parent) / f"{socket_name}.lock"):
            leftover.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
