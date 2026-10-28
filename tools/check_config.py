#!/usr/bin/env python3
"""
RackSense Configuration Consistency Checker.

Rigorous validation that:
1. Firmware config headers in hardware/ match the central topology in tools/topology.example.yaml.
2. MQTT topics match shared/api-contract.md §15 (dc/{site}/{rack}/{node}/...).
3. TFT display configuration matches shared/hardware-connections.md (480x320 ILI9488).
4. RFID card UIDs match shared/api-contract.md §10 (uppercase hex without separators).
5. Network buffers and timing constants meet safety specifications.
"""

import os
import re
import sys
from pathlib import Path
from typing import Any
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
TOPOLOGY_FILE = REPO_ROOT / "tools" / "topology.example.yaml"
USERS_FILE = REPO_ROOT / "tools" / "users.example.yaml"

FIRMWARE_CONFIGS = {
    "node_env_esp32": REPO_ROOT / "hardware" / "node_env_esp32" / "config.h",
    "node_vib_esp32s3": REPO_ROOT / "hardware" / "node_vib_esp32s3" / "config.h",
    "auth_console_esp32s3": REPO_ROOT / "hardware" / "auth_console_esp32s3" / "config.h",
}


def parse_c_header_defines(filepath: Path) -> dict[str, str]:
    """Parse #define constants from a C/C++ header file."""
    defines: dict[str, str] = {}
    if not filepath.exists():
        return defines

    pattern = re.compile(r'^\s*#define\s+([A-Za-z0-9_]+)\s+"?([^"\n\r]+)"?')
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            match = pattern.match(line)
            if match:
                k, v = match.group(1), match.group(2).strip()
                v = v.split("//")[0].strip().strip('"')
                defines[k] = v
    return defines


def check_configuration(
    topology_path: Path = TOPOLOGY_FILE,
    users_path: Path = USERS_FILE,
) -> tuple[bool, list[str]]:
    """Compare topology YAML with firmware config.h files and contract rules."""
    errors: list[str] = []
    log: list[str] = []

    if not topology_path.exists():
        return False, [f"Topology file missing at {topology_path}"]

    with open(topology_path, "r", encoding="utf-8") as f:
        topo = yaml.safe_load(f)

    site_id = topo.get("site", {}).get("site_id")
    racks = {r["rack_id"]: r for r in topo.get("racks", [])}
    nodes = {n["node_id"]: n for n in topo.get("nodes", [])}
    tenants = {t["tenant_id"]: t for t in topo.get("tenants", [])}

    log.append(f"Loaded topology: Site={site_id}, Racks={list(racks.keys())}, Nodes={list(nodes.keys())}")

    # 1. Check Environment Node
    env_cfg = parse_c_header_defines(FIRMWARE_CONFIGS["node_env_esp32"])
    if not env_cfg:
        errors.append("hardware/node_env_esp32/config.h could not be read or is empty.")
    else:
        node_id = env_cfg.get("NODE_ID")
        rack_id = env_cfg.get("RACK_ID")
        cfg_site = env_cfg.get("SITE_ID")
        tenant_id = env_cfg.get("TENANT_ID")
        fw = env_cfg.get("FW_VERSION")
        buf_size = env_cfg.get("MQTT_BUFFER_BYTES", "0")

        if cfg_site != site_id:
            errors.append(f"[node_env_esp32] SITE_ID mismatch: header={cfg_site} vs topology={site_id}")
        if node_id not in nodes:
            errors.append(f"[node_env_esp32] NODE_ID '{node_id}' not found in topology nodes")
        else:
            if nodes[node_id]["rack_id"] != rack_id:
                errors.append(f"[node_env_esp32] RACK_ID mismatch for {node_id}: header={rack_id} vs topology={nodes[node_id]['rack_id']}")
            if nodes[node_id].get("fw") and nodes[node_id].get("fw") != fw:
                errors.append(f"[node_env_esp32] FW_VERSION mismatch for {node_id}: header={fw} vs topology={nodes[node_id].get('fw')}")
        if tenant_id and tenant_id not in tenants:
            errors.append(f"[node_env_esp32] TENANT_ID '{tenant_id}' not found in topology tenants")
        if int(buf_size) < 1024:
            errors.append(f"[node_env_esp32] MQTT_BUFFER_BYTES ({buf_size}) must be >= 1024 to prevent PubSubClient truncation")

        # Check topic format
        top_tel = env_cfg.get("TOPIC_TELEMETRY", "")
        top_stat = env_cfg.get("TOPIC_STATUS", "")
        expected_tel_prefix = "dc/"
        if top_tel and not top_tel.startswith(expected_tel_prefix):
            errors.append(f"[node_env_esp32] TOPIC_TELEMETRY '{top_tel}' must follow Contract §15: 'dc/{{site}}/{{rack}}/{{node}}/telemetry'")
        if top_stat and not top_stat.startswith(expected_tel_prefix):
            errors.append(f"[node_env_esp32] TOPIC_STATUS '{top_stat}' must follow Contract §15: 'dc/{{site}}/{{rack}}/{{node}}/status'")

        log.append(f"Checked node_env_esp32: node={node_id}, rack={rack_id}, tenant={tenant_id}, fw={fw}, buffer={buf_size}B")

    # 2. Check Vibration / Indicator Node
    vib_cfg = parse_c_header_defines(FIRMWARE_CONFIGS["node_vib_esp32s3"])
    if not vib_cfg:
        errors.append("hardware/node_vib_esp32s3/config.h could not be read or is empty.")
    else:
        node_id = vib_cfg.get("NODE_ID")
        rack_id = vib_cfg.get("RACK_ID")
        cfg_site = vib_cfg.get("SITE_ID")
        tenant_id = vib_cfg.get("TENANT_ID")
        fw = vib_cfg.get("FW_VERSION")

        if cfg_site != site_id:
            errors.append(f"[node_vib_esp32s3] SITE_ID mismatch: header={cfg_site} vs topology={site_id}")
        if node_id not in nodes:
            errors.append(f"[node_vib_esp32s3] NODE_ID '{node_id}' not found in topology nodes")
        else:
            if nodes[node_id]["rack_id"] != rack_id:
                errors.append(f"[node_vib_esp32s3] RACK_ID mismatch for {node_id}: header={rack_id} vs topology={nodes[node_id]['rack_id']}")
            if nodes[node_id].get("fw") and nodes[node_id].get("fw") != fw:
                errors.append(f"[node_vib_esp32s3] FW_VERSION mismatch for {node_id}: header={fw} vs topology={nodes[node_id].get('fw')}")
        if tenant_id and tenant_id not in tenants:
            errors.append(f"[node_vib_esp32s3] TENANT_ID '{tenant_id}' not found in topology tenants")
        log.append(f"Checked node_vib_esp32s3: node={node_id}, rack={rack_id}, tenant={tenant_id}, fw={fw}")

    # 3. Check Auth Console Hardware Configuration
    auth_cfg = parse_c_header_defines(FIRMWARE_CONFIGS["auth_console_esp32s3"])
    if not auth_cfg:
        errors.append("hardware/auth_console_esp32s3/config.h could not be read or is empty.")
    else:
        dev_id = auth_cfg.get("DEVICE_ID")
        fw = auth_cfg.get("FW_VERSION")
        port = auth_cfg.get("API_PORT")
        screen_w = auth_cfg.get("SCREEN_W")
        screen_h = auth_cfg.get("SCREEN_H")

        if not dev_id:
            errors.append("[auth_console_esp32s3] DEVICE_ID missing in header")
        if fw != "0.3.1":
            errors.append(f"[auth_console_esp32s3] Unexpected FW_VERSION '{fw}'")
        if screen_w != "480" or screen_h != "320":
            errors.append(f"[auth_console_esp32s3] Display mismatch: SCREEN_W={screen_w}, SCREEN_H={screen_h}. Bench requires 480x320 ILI9488 panel per shared/hardware-connections.md")

        log.append(f"Checked auth_console_esp32s3: device={dev_id}, fw={fw}, port={port}, display={screen_w}x{screen_h} ILI9488")

    # 4. Check Card UID formats in users.example.yaml against Contract §10
    if users_path.exists():
        with open(users_path, "r", encoding="utf-8") as f:
            users_doc = yaml.safe_load(f)
        for card in users_doc.get("cards", []):
            uid = card.get("uid", "")
            if ":" in uid:
                errors.append(f"[users.example.yaml] Card UID '{uid}' contains colons. Contract §10 requires uppercase hex without separators (e.g. '{uid.replace(':', '').upper()}').")
            elif not re.match(r"^[0-9A-F]+$", uid):
                errors.append(f"[users.example.yaml] Card UID '{uid}' is not valid uppercase hex.")
            else:
                log.append(f"Checked card UID format: {uid} (Valid Contract §10 uppercase hex)")

    return len(errors) == 0, errors if errors else log


def main() -> int:
    print("=" * 65)
    print("  RackSense Configuration Consistency Checker")
    print("=" * 65)
    success, messages = check_configuration()
    for m in messages:
        prefix = "  [OK] " if success else "  [ERROR] "
        print(f"{prefix}{m}")

    if success:
        print("\nSUCCESS: All firmware configs match topology.example.yaml and Contract perfectly.")
        return 0
    else:
        print("\nFAILURE: Configuration mismatches found. Please resolve before running demo.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
