"""Run from the interactive desktop token to avoid packaged-app redirection.

SQLite's online backup reads a consistent committed snapshot, including the WAL.
Only the disposable destination is written. Notebook data stays in test-results.
"""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys

source = Path(os.environ["LOCALAPPDATA"]) / "com.knot.desktop" / "Workspace"
target = Path(sys.argv[1]).resolve()
results = Path(__file__).resolve().parents[2] / "test-results"
if not target.is_relative_to(results):
    raise ValueError("Snapshot destination must be inside test-results")
target.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(source.joinpath("knot.db").as_uri() + "?mode=ro", uri=True) as active:
    catalog = active.execute("SELECT id,title,kind FROM objects WHERE deleted_at IS NULL").fetchall()
    if not any(row[1] == "Software Testing" for row in catalog):
        raise ValueError("Software Testing is missing from the desktop workspace")
    with sqlite3.connect(target / "knot.db") as disposable:
        active.backup(disposable)
shutil.copyfile(source / "workspace.json", target / "workspace.json")
shutil.copytree(source / "assets", target / "assets", dirs_exist_ok=True)
(target / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
