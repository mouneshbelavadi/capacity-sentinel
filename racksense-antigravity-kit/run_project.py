#!/usr/bin/env python3
"""
RackSense One-Click Auto-Launcher & Runner.
"""

from pathlib import Path
import os
import sys

WORKSPACE = Path(r"C:\Users\moune\OneDrive\Desktop\capacity-sentinel")
sys.path.insert(0, str(WORKSPACE))
os.chdir(str(WORKSPACE))

import run_project
if __name__ == "__main__":
    run_project.main()
