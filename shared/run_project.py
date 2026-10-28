#!/usr/bin/env python3
"""
RackSense One-Click Auto-Launcher & Runner (Shared Wrapper).

Calls the main run_project.py at the project root.
Can be double-clicked directly from the shared/ folder.
"""

from pathlib import Path
import sys

# Locate root run_project.py
SHARED_DIR = Path(__file__).resolve().parent
ROOT_DIR = SHARED_DIR.parent

if (ROOT_DIR / "run_project.py").exists():
    sys.path.insert(0, str(ROOT_DIR))
    import run_project
    run_project.main()
else:
    # Fallback to desktop workspace
    WORKSPACE = Path(r"C:\Users\moune\OneDrive\Desktop\capacity-sentinel")
    sys.path.insert(0, str(WORKSPACE))
    import run_project
    run_project.main()
