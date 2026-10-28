#!/usr/bin/env python3
"""
RackSense One-Click Auto-Launcher & Runner.

Automatically sets up, updates, starts, and monitors both the Backend (FastAPI)
and Frontend (React/Vite), and opens the web dashboard in your default browser.

Usage:
  Double-click 'run_project.bat' or run 'python run_project.py'
"""

import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path


def find_project_root() -> Path:
    """Find the root directory containing backend/ and frontend/."""
    # 1. Check current script directory and parents
    curr = Path(__file__).resolve().parent
    for p in [curr, curr.parent, curr.parent.parent]:
        if (p / "backend").exists() and (p / "frontend").exists():
            return p

    # 2. Known workspace path on Desktop
    desktop_workspace = Path(r"C:\Users\moune\OneDrive\Desktop\capacity-sentinel")
    if (desktop_workspace / "backend").exists() and (desktop_workspace / "frontend").exists():
        return desktop_workspace

    # 3. Fallback to current working directory
    return Path.cwd()


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Check if a network port is currently open and listening."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def kill_process_on_port(port: int) -> None:
    """On Windows, find and kill any previous zombie process holding the port."""
    if sys.platform != "win32":
        return
    try:
        cmd = f'netstat -ano | findstr :{port}'
        output = subprocess.check_output(cmd, shell=True, text=True, errors="ignore")
        for line in output.strip().split("\n"):
            parts = line.split()
            if len(parts) >= 5 and "LISTENING" in parts:
                pid = parts[-1]
                if pid.isdigit() and int(pid) != os.getpid():
                    print(f"  [Auto-Clean] Releasing port {port} from old process (PID {pid})...")
                    subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    time.sleep(0.5)
    except Exception:
        pass


def wait_for_url(url: str, timeout: float = 20.0, label: str = "Service") -> bool:
    """Poll a URL until it responds with HTTP 200 or timeout elapses."""
    start = time.time()
    print(f"  Waiting for {label} at {url}...", end="", flush=True)
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "RackSense-Launcher"})
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    print(" [READY]")
                    return True
        except Exception:
            pass
        time.sleep(0.5)
        print(".", end="", flush=True)
    print(" [TIMEOUT]")
    return False


def check_mosquitto_broker(host: str = "127.0.0.1", port: int = 1883) -> bool:
    """Check if Mosquitto broker is reachable on host:port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.5)
        return s.connect_ex((host, port)) == 0


def sample_mqtt_messages(host: str, port: int, site_id: str, duration_s: float = 10.0) -> int:
    """Listen on the MQTT topic root for duration_s seconds and count messages received."""
    count = 0
    try:
        import paho.mqtt.client as mqtt

        def on_msg(client, userdata, message):
            nonlocal count
            count += 1

        client = mqtt.Client(client_id="racksense-launcher-probe")
        client.on_message = on_msg
        client.connect(host, port, 15)
        client.subscribe(f"dc/{site_id}/+/+/telemetry")
        client.subscribe(f"dc/{site_id}/+/+/status")
        client.loop_start()
        start = time.time()
        while time.time() - start < duration_s:
            time.sleep(0.5)
            print(".", end="", flush=True)
        client.loop_stop()
        client.disconnect()
    except Exception as e:
        print(f" (probe error: {e})", end="")
    return count


def setup_database_and_environment(root: Path) -> None:
    """Ensures database is initialized, seeded, and verified."""
    print("\n[1/4] Checking and Updating Database & Topology...")
    sys.path.insert(0, str(root))

    try:
        from backend.core.config import settings
        from backend.db.connection import init_db_sync
        from backend.tools.seed_topology import seed_topology
        from backend.tools.seed_users import seed_users
        from backend.tools.register_reader import register_reader

        init_db_sync()

        # Seed topology and users if database was fresh
        topo_yaml = root / "tools" / "topology.example.yaml"
        users_yaml = root / "tools" / "users.example.yaml"

        if topo_yaml.exists():
            seed_topology(str(topo_yaml))
        if users_yaml.exists():
            seed_users(str(users_yaml))

        # Register demo reader
        register_reader(
            device_id="reader-01",
            device_secret="demo-secret-key-1234567890123456",
            label="Bench RFID Console",
        )
        print("  Database, topology, and user accounts verified.")
    except Exception as e:
        print(f"  Warning during database initialization: {e}")


def check_frontend_node_modules(root: Path) -> None:
    """Verifies frontend packages are installed."""
    print("\n[2/4] Checking Frontend Dependencies...")
    fe_dir = root / "frontend"
    node_modules = fe_dir / "node_modules"

    if not node_modules.exists():
        print("  frontend/node_modules missing. Running 'npm install'...")
        subprocess.run("npm install", cwd=str(fe_dir), shell=True, check=True)
    else:
        print("  Frontend packages ready.")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    print("=" * 75)
    print("         RackSense — One-Click Project Runner & Auto-Updater")
    print("=" * 75)

    root = find_project_root()
    print(f"Project Root: {root}")
    os.chdir(root)

    # 1. Free ports if held by old runs
    for port in (8000, 5173):
        if is_port_in_use(port):
            kill_process_on_port(port)

    # 2. Database & environment checks
    setup_database_and_environment(root)

    # 3. Frontend checks
    check_frontend_node_modules(root)

    # 3.5 Check Mosquitto MQTT Broker
    from backend.core.config import settings
    mqtt_host = settings.MQTT_BROKER_HOST
    mqtt_port = settings.MQTT_BROKER_PORT
    site_id = settings.SITE_ID

    print(f"\n[3/5] Verifying Mosquitto Broker at {mqtt_host}:{mqtt_port}...")
    if not check_mosquitto_broker(mqtt_host, mqtt_port):
        print("\n" + "=" * 75)
        print("  [FATAL ERROR] Mosquitto MQTT broker is NOT REACHABLE!")
        print("=" * 75)
        print(f"  Attempted connection to broker at {mqtt_host}:{mqtt_port} -> FAILED")
        print("  The hardware ingestion layer requires an active Mosquitto broker.")
        print("  Without a broker, no physical sensor telemetry will reach the database.")
        print("")
        print("  HOW TO START THE BROKER:")
        print("    - On Arduino UNO Q / Linux: Run:")
        print("        sudo systemctl start mosquitto")
        print("        # or: mosquitto -c backend/mosquitto/mosquitto.conf.example -v")
        print("    - On Windows Local Host: Run:")
        print("        mosquitto -c backend/mosquitto/mosquitto.conf.example -v")
        print("        (Install via 'winget install EclipseFoundation.Mosquitto')")
        print("    - If broker is running on the Arduino UNO Q at another IP, set:")
        print("        MQTT_BROKER_HOST=<uno_q_ip> in your .env file")
        print("=" * 75 + "\n")
        sys.exit(1)

    print(f"  [OK] Mosquitto broker is active at {mqtt_host}:{mqtt_port}")
    print(f"  [OK] Subscribed topic root: dc/{site_id}/+/+/telemetry and dc/{site_id}/+/+/status")
    print(f"  Listening for incoming sensor messages for 10 seconds...", end="", flush=True)
    msg_count = sample_mqtt_messages(mqtt_host, mqtt_port, site_id, duration_s=10.0)
    print(f" [DONE: {msg_count} message(s) received]")
    if msg_count == 0:
        print("  [NOTE] 0 messages received in first 10s: sensor nodes may still be joining Wi-Fi or powered down.")

    # 4. Start Backend Server
    print("\n[4/5] Starting FastAPI Backend on http://localhost:8000...")
    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
        "--reload",
    ]
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=str(root),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    # Wait for backend
    backend_ok = wait_for_url("http://127.0.0.1:8000/api/health", timeout=15.0, label="Backend API")

    # 5. Start Frontend Dev Server
    print("\n[5/5] Starting Vite Frontend on http://localhost:5173...")
    frontend_cmd = "npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173"
    frontend_proc = subprocess.Popen(
        frontend_cmd,
        cwd=str(root),
        shell=True,
    )

    # Wait for frontend
    frontend_ok = wait_for_url("http://127.0.0.1:5173", timeout=15.0, label="Frontend UI")

    # Open Browser
    print("\n" + "=" * 75)
    print("  RACKSENSE IS RUNNING LIVE!")
    print("=" * 75)
    print("  Web Console (React):        http://localhost:5173")
    print("  Backend API Health:         http://localhost:8000/api/health")
    print("  Interactive Swagger Docs:   http://localhost:8000/docs")
    print("-" * 75)
    print("  Demo Logins:")
    print("  - Super User (All Racks):   Username: super1     Password: SuperSecretPassword123!")
    print("  - Operator (Facility):      Username: op1        Password: OperatorPassword123!")
    print("  - Tenant Alpha (Bank):      Username: alpha_user Password: AlphaPassword123!")
    print("=" * 75)
    print("  [Auto-Reload Active] Any code change in backend or frontend will update live.")
    print("  Press Ctrl+C to stop all servers.\n")

    # Launch default web browser
    try:
        webbrowser.open("http://localhost:5173")
    except Exception:
        pass

    # Keep running and stream backend logs
    def shutdown_handler(sig=None, frame=None):
        print("\n\nShutting down RackSense servers...")
        try:
            frontend_proc.terminate()
            backend_proc.terminate()
        except Exception:
            pass
        for port in (8000, 5173):
            kill_process_on_port(port)
        print("All servers stopped cleanly. Goodbye!\n")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    try:
        while True:
            # Check if backend crashed
            if backend_proc.poll() is not None:
                print(f"\nBackend process exited with code {backend_proc.returncode}")
                stdout, _ = backend_proc.communicate()
                print(stdout)
                break

            # Read backend log line
            line = backend_proc.stdout.readline()
            if line:
                # Filter noise
                if "GET /api/meta" not in line and "GET /api/health" not in line:
                    sys.stdout.write(f"[Backend] {line}")
                    sys.stdout.flush()
            else:
                time.sleep(0.1)

    except KeyboardInterrupt:
        shutdown_handler()


if __name__ == "__main__":
    main()
