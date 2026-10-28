#!/usr/bin/env python3
"""
RackSense Configuration Consistency Checker.

Verifies that firmware config headers in hardware/ match the central
topology configuration in tools/topology.example.yaml.
Run this script before demo and firmware flashing to avoid mismatched node/rack IDs.
"""

import os
import re
import sys
from pathlib import Path
from typing import Any
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
TOPOLOGY_FILE = REPO_ROOT / "tools" / "topology.example.yaml"

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
                # Clean trailing quotes or comments if any
                v = v.split("//")[0].strip().strip('"')
                defines[k] = v
    return defines


def check_configuration(topology_path: Path = TOPOLOGY_FILE) -> tuple[bool, list[str]]:
    """Compare topology YAML with firmware config.h files."""
    errors: list[str] = []
    log: list[str] = []

    if not topology_path.exists():
        return False, [f"Topology file missing at {topology_path}"]

    with open(topology_path, "r", encoding="utf-8") as f:
        topo = yaml.safe_load(f)

    site_id = topo.get("site", {}).get("site_id")
    racks = {r["rack_id"]: r for r in topo.get("racks", [])}
    nodes = {n["node_id"]: n for n in topo.get("nodes", [])}
    slots = {s["slot_id"]: s for s in topo.get("slots", [])}
    tenants = {t["tenant_id"]: t for t in topo.get("tenants", [])}

    log.append(f"Loaded topology: Site={site_id}, Racks={list(racks.keys())}, Nodes={list(nodes.keys())}")

    # Check Environment Node
    env_cfg = parse_c_header_defines(FIRMWARE_CONFIGS["node_env_esp32"])
    if not env_cfg:
        errors.append("hardware/node_env_esp32/config.h could not be read or is empty.")
    else:
        node_id = env_cfg.get("NODE_ID")
        rack_id = env_cfg.get("RACK_ID")
        cfg_site = env_cfg.get("SITE_ID")
        tenant_id = env_cfg.get("TENANT_ID")
        fw = env_cfg.get("FW_VERSION")

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
        log.append(f"Checked node_env_esp32: node={node_id}, rack={rack_id}, tenant={tenant_id}, fw={fw}")

    # Check Vibration Node
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

    # Check Auth Console
    auth_cfg = parse_c_header_defines(FIRMWARE_CONFIGS["auth_console_esp32s3"])
    if not auth_cfg:
        errors.append("hardware/auth_console_esp32s3/config.h could not be read or is empty.")
    else:
        dev_id = auth_cfg.get("DEVICE_ID")
        fw = auth_cfg.get("FW_VERSION")
        port = auth_cfg.get("API_PORT")
        if not dev_id:
            errors.append("[auth_console_esp32s3] DEVICE_ID missing in header")
        if fw != "0.3.1":
            errors.append(f"[auth_console_esp32s3] Unexpected FW_VERSION '{fw}'")
        log.append(f"Checked auth_console_esp32s3: device={dev_id}, fw={fw}, port={port}")

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
        print("\nSUCCESS: All firmware configs match topology.example.yaml perfectly.")
        return 0
    else:
        print("\nFAILURE: Configuration mismatches found. Please resolve before running demo.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
