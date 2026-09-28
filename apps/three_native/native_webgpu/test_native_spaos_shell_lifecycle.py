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


def wait_for_log(process: subprocess.Popen, log_path: Path, pattern: str,
                 predicate, timeout: float = 20) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"SPAOS exited during Shell catalog test: {process.returncode}")
        values = [int(value) for value in re.findall(pattern,
            log_path.read_text(errors="replace"))]
        if values and predicate(values):
            return values[-1]
        time.sleep(.25)
    raise TimeoutError(f"SPAOS log did not reach expected {pattern}")


def probe_harness(door: Path) -> None:
    deadline = time.monotonic() + 20
    while not door.is_socket() and time.monotonic() < deadline:
        time.sleep(.25)
    if not door.is_socket():
        raise RuntimeError("SPAOS test World door did not open")
    with socket.socket(socket.AF_UNIX) as world:
        world.settimeout(30)
        world.connect(str(door))
        world.sendall(b'{"type":"hello","protocol":1}\n')
        stream = world.makefile("r")
        while time.monotonic() < deadline:
            event = json.loads(stream.readline())
            if event.get("type") != "apps" or not event.get("harness"):
                continue
            names = {verb["name"] for verb in event["harness"]}
            if {"app.list", "app.close", "app.move", "view.show"} <= names:
                catalog_world_apps = sum(bool(app.get("world")) for app in event["apps"])
                if not catalog_world_apps:
                    raise RuntimeError("No installed SPAOS apps authenticated; check the exact Electron runtime path")
                calculator = next((app for app in event["apps"]
                    if app.get("key") == "calculator"), None)
                if not calculator or "calculator.open" not in {
                    verb.get("name") for verb in calculator.get("verbs", [])}:
                    raise RuntimeError("Native Shell did not publish Calculator's open verb")
                break
        else:
            raise RuntimeError("SPAOS did not publish the native Shell harness verbs")
        deadline = time.monotonic() + 60
        latest_spaces = []
        def call(verb: str, args: dict, index: int) -> dict:
            nonlocal latest_spaces
            call_id = f"native-harness-{index}"
            world.sendall((json.dumps({"type": "call", "verb": verb, "args": args,
                "callId": call_id}) + "\n").encode())
            while time.monotonic() < deadline:
                event = json.loads(stream.readline())
                if event.get("type") == "spaces":
                    latest_spaces = event.get("spaces", [])
                if event.get("type") == "call_result" and event.get("callId") == call_id:
                    return event["result"]
            raise RuntimeError(f"No Shell harness answer for {verb}")
        calls = [
            ("app.list", {}, True),
            ("app.close", {"app": "not-an-installed-app"}, False),
            ("view.show", {"target": "not-a-space"}, False),
        ]
        for index, (verb, args, expected_ok) in enumerate(calls):
            result = call(verb, args, index)
            if result.get("verb") != verb or result.get("ok") is not expected_ok:
                raise RuntimeError(f"Wrong Shell harness answer for {verb}: {result}")
            if verb == "app.list" and len(result["outcome"]["apps"]) != catalog_world_apps:
                raise RuntimeError(f"Shell harness disagreed with the published app catalog: {result}")
        opened = call("calculator.open", {}, 3)
        if not opened.get("ok") or opened.get("outcome", {}).get("stood") is not True:
            raise RuntimeError(f"Shell harness did not launch Calculator: {opened}")
        early_repeat = call("calculator.open", {}, 4)
        if not early_repeat.get("ok") or early_repeat.get("outcome", {}).get("stood") is not False:
            raise RuntimeError(f"Shell harness repeated Calculator startup: {early_repeat}")
        app_id = calculator.get("appId")
        if not app_id:
            raise RuntimeError("Calculator has no authenticated app ID")
        while time.monotonic() < deadline:
            if any(app_id in space.get("apps", []) for space in latest_spaces):
                break
            event = json.loads(stream.readline())
            if event.get("type") == "spaces":
                latest_spaces = event.get("spaces", [])
        else:
            raise RuntimeError("Calculator launched but never mapped onto SPAOS's floor")
        listed = call("app.list", {}, 5)
        if not next(app for app in listed["outcome"]["apps"]
                    if app["app"] == "calculator")["open"]:
            raise RuntimeError(f"Shell harness could not see mapped Calculator: {listed}")
        moved = call("app.move", {"app": "calculator", "x": 3, "z": 2}, 6)
        if not moved.get("ok") or moved.get("outcome", {}).get("windows", 0) < 1:
            raise RuntimeError(f"Shell harness did not move Calculator: {moved}")
        while time.monotonic() < deadline:
            if any(
                app_id in space.get("apps", []) and space.get("at") == {"x": 3, "z": 2}
                for space in latest_spaces):
                break
            event = json.loads(stream.readline())
            if event.get("type") == "spaces":
                latest_spaces = event.get("spaces", [])
        else:
            raise RuntimeError("Calculator move did not reach SPAOS's floor")
        shown = call("view.show", {"target": "calculator"}, 7)
        if not shown.get("ok") or shown.get("outcome", {}).get("x") != 3 or \
                shown.get("outcome", {}).get("z") != 2:
            raise RuntimeError(f"Shell harness did not show moved Calculator: {shown}")
        repeated = call("calculator.open", {}, 8)
        if not repeated.get("ok") or repeated.get("outcome", {}).get("stood") is not False:
            raise RuntimeError(f"Shell harness duplicated Calculator: {repeated}")
        closed = call("app.close", {"app": "calculator"}, 9)
        if not closed.get("ok") or closed.get("outcome", {}).get("windows", 0) < 1:
            raise RuntimeError(f"Shell harness did not close mapped Calculator: {closed}")
        destination = call("whatsapp.open", {"chat": "unavailable"}, 10)
        if destination.get("ok") or destination.get("error", {}).get("code") != "app-unavailable":
            raise RuntimeError(f"Shell harness silently dropped open arguments: {destination}")


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
    parser.add_argument("--expect-shell-unready", action="store_true",
                        help="verify a missing renderer bundle cannot make Shell ready")
    parser.add_argument("--test-host-refresh", action="store_true",
                        help="verify live XDG install and removal reach the World launcher")
    parser.add_argument("--test-harness", action="store_true",
                        help="call Shell-owned verbs through SPAOS's isolated World test door")
    args = parser.parse_args()
    if sum((args.expect_shell_unready, args.test_host_refresh, args.test_harness)) > 1:
        parser.error("choose one Shell lifecycle test mode")
    runtime_parent = os.environ.get("XDG_RUNTIME_DIR")
    host_display = os.environ.get("WAYLAND_DISPLAY")
    node = shutil.which("node")
    if not runtime_parent or not host_display or not node:
        parser.error("XDG_RUNTIME_DIR, WAYLAND_DISPLAY and Node are required")
    required_paths = ("spaos", "native", "world_bundle", "assets", "controller", "desktop", "electron")
    if not args.expect_shell_unready:
        required_paths += ("shell_bundle",)
    for name in required_paths:
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
        if args.test_host_refresh:
            environment["VALDI_SHELL_CATALOG_POLL_MS"] = "1000"
        if args.test_harness:
            environment["SPAOS_CHANNEL_DOOR"] = "1"
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
                if args.expect_shell_unready:
                    if args.shell_bundle.exists():
                        raise RuntimeError("Failure test requires a nonexistent Shell bundle")
                    before = wait_for_status(process, endpoint, token,
                        lambda status: status["targets"]["world"]["ready"])
                    deadline = time.monotonic() + 6
                    while time.monotonic() < deadline:
                        status = request(endpoint, token, {"op": "status"})
                        if status["targets"]["shell"]["ready"]:
                            raise RuntimeError("SPAOS marked a missing native Shell renderer ready")
                        time.sleep(.25)
                    output = log_path.read_text(errors="replace")
                    if "native Space UI frame presented; Shell lifecycle ready" in output:
                        raise RuntimeError("Shell controller reported readiness without a GPU frame")
                    if "Cannot open JavaScript bundle" not in output:
                        raise RuntimeError("Failure test did not reach the missing renderer bundle")
                    print("SPAOS Shell failure path passed: World ready, renderer failed, Shell unready")
                    return
                before = wait_for_status(process, endpoint, token,
                    lambda status: status["targets"]["world"]["ready"] and
                    status["targets"]["shell"]["ready"])
                if args.test_harness:
                    probe_harness(Path(runtime_parent) / f"{socket_name}.apps" / "world.sock")
                    print("SPAOS native Shell harness passed: list, open, move, show, focus and close Calculator")
                    return
                if args.test_host_refresh:
                    host_pattern = r"published \d+ authenticated SPAOS apps, (\d+) host apps"
                    world_pattern = r"WorldOS app catalog received: (\d+) visible apps"
                    matches = lambda pattern: re.findall(pattern,
                        log_path.read_text(errors="replace"))
                    initial_host = wait_for_log(process, log_path, host_pattern, lambda values: True)
                    initial_world = wait_for_log(process, log_path, world_pattern, lambda values: True)
                    app_dir = runtime / "data" / "applications"
                    app_dir.mkdir(parents=True, exist_ok=True)
                    fixture = app_dir / "valdi-refresh-fixture.desktop"
                    fixture.write_text("[Desktop Entry]\nType=Application\n"
                                       "Name=Valdi Refresh Fixture\nExec=/usr/bin/true\n")
                    wait_for_log(process, log_path, host_pattern,
                                 lambda values: (initial_host + 1) in values)
                    wait_for_log(process, log_path, world_pattern,
                                 lambda values: (initial_world + 1) in values)
                    settings_files = list((runtime / "config").rglob("settings.json"))
                    if len(settings_files) != 1:
                        raise RuntimeError(f"Expected one compositor settings file: {settings_files}")
                    settings_file = settings_files[0]
                    def set_hidden(ids: list[str]) -> None:
                        temporary = settings_file.with_suffix(".json.tmp")
                        temporary.write_text(json.dumps({"launcher": {"hiddenApps": ids}}))
                        temporary.replace(settings_file)
                    world_seen = len(matches(world_pattern))
                    set_hidden(["valdi-refresh-fixture.desktop"])
                    wait_for_log(process, log_path, world_pattern,
                                 lambda values: len(values) > world_seen and values[-1] == initial_world)
                    world_seen = len(matches(world_pattern))
                    set_hidden([])
                    wait_for_log(process, log_path, world_pattern,
                                 lambda values: len(values) > world_seen and
                                 values[-1] == initial_world + 1)
                    world_seen = len(matches(world_pattern))
                    fixture.unlink()
                    wait_for_log(process, log_path, host_pattern,
                                 lambda values: len(values) >= 3 and values[-1] == initial_host)
                    wait_for_log(process, log_path, world_pattern,
                                 lambda values: len(values) > world_seen and values[-1] == initial_world)
                    print(f"SPAOS native catalog refresh passed: {initial_host} -> "
                          f"{initial_host + 1} -> {initial_host} host apps; "
                          "World updated for install, hide, unhide and removal")
                    return
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
        if args.test_harness:
            shutil.rmtree(Path(runtime_parent) / f"{socket_name}.apps", ignore_errors=True)


if __name__ == "__main__":
    main()
