#!/usr/bin/env python3
"""Real Chrome manifest/file validation. This does NOT load the extension."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

source = Path(__file__).resolve().parents[1] / "extension"
chrome = os.environ.get("CHROME_EXECUTABLE", "google-chrome")
version = subprocess.run([chrome, "--version"], capture_output=True, text=True, check=True).stdout.strip()

def bad_version(extension, manifest):
    manifest["version"] = "invalid"

def bad_match(extension, manifest):
    manifest["content_scripts"][0]["matches"] = ["this-is-not-a-url-pattern"]

def missing_script(extension, manifest):
    (extension / "content.js").unlink()

def missing_icon(extension, manifest):
    (extension / "icons" / "icon128.png").unlink()

cases = [
    ("current source is accepted", None, True),
    ("invalid version is rejected", bad_version, False),
    ("invalid match is rejected", bad_match, False),
    ("missing script is rejected", missing_script, False),
    ("missing icon is rejected", missing_icon, False),
]
results = []
for name, mutate, expected in cases:
    with tempfile.TemporaryDirectory(prefix="search-clean-package-") as temporary:
        extension = Path(temporary) / "extension"
        shutil.copytree(source, extension)
        manifest_path = extension / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        if mutate:
            mutate(extension, manifest)
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False))
        process = subprocess.run([chrome, "--no-sandbox", "--disable-dev-shm-usage", "--pack-extension="+str(extension)], capture_output=True, text=True, timeout=30)
        created = extension.with_suffix(".crx").is_file()
        accepted = process.returncode == 0 and created
        results.append({"name": name, "expected_accept": expected, "observed_accept": accepted, "exit_code": process.returncode, "pass": accepted == expected})

report = {
    "browser": version,
    "mode": "Chrome CLI --pack-extension validation only. Extension NOT loaded; no storage context or live Google access.",
    "source_version": json.loads((source / "manifest.json").read_text())["version"],
    "source_sha256": {p.relative_to(source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(source.rglob("*")) if p.is_file()},
    "tests": results,
}
print(json.dumps(report, ensure_ascii=False, indent=2))
if not all(r["pass"] for r in results):
    raise SystemExit(1)
