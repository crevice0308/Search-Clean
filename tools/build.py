#!/usr/bin/env python3
"""Build a development-source archive, never overwrite the published release."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib

root = Path(__file__).resolve().parents[1]
output = root.parent / "Search-Clean-native-updater-prototype-source.zip"
prefix = "Search-Clean-native-updater-prototype-source"
with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(root.rglob("*")):
        if not path.is_file() or any(part in {"node_modules", "__pycache__", ".git", "managed", ".venv", "venv"} for part in path.parts):
            continue
        if path.suffix in {".pyc", ".log", ".zip", ".pem", ".key"}:
            continue
        archive.write(path, f"{prefix}/{path.relative_to(root).as_posix()}")
print(f"{output}\n{output.stat().st_size} bytes\nSHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}")
