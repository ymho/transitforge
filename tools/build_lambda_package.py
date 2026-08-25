#!/usr/bin/env python3
"""Build and validate the Lambda artifact defined by infra/packaging."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).parents[1]
MANIFEST_PATH = REPOSITORY_ROOT / "infra" / "packaging" / "agent-api.json"
MAXIMUM_SOURCE_FILE_BYTES = 1_000_000


def load_manifest(repository_root: Path = REPOSITORY_ROOT) -> dict[str, Any]:
    path = repository_root / "infra" / "packaging" / "agent-api.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Lambda package manifest must be an object")
    return value


def source_files(repository_root: Path, manifest: dict[str, Any]) -> list[Path]:
    source = repository_root / manifest["source"]
    extensions = frozenset(manifest["includeExtensions"])
    excluded = frozenset(manifest["excludeDirectories"])
    if not source.is_dir():
        raise ValueError(f"Lambda source directory does not exist: {source}")
    files = [
        path
        for path in source.rglob("*")
        if path.is_file()
        and not path.is_symlink()
        and path.suffix in extensions
        and not excluded.intersection(path.relative_to(source).parts)
    ]
    if not files:
        raise ValueError("Lambda package has no source files")
    return sorted(files)


def validate_sources(
    repository_root: Path,
    manifest: dict[str, Any],
    files: list[Path],
) -> None:
    source = repository_root / manifest["source"]
    handler_module, handler_function = manifest["handler"].split(".", 1)
    handler_path = source / f"{handler_module}.py"
    if handler_path not in files:
        raise ValueError(f"Lambda handler module is missing: {handler_path.name}")
    for path in files:
        if path.stat().st_size > MAXIMUM_SOURCE_FILE_BYTES:
            raise ValueError(f"Lambda source file is too large: {path.relative_to(source)}")
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        if path == handler_path and not any(
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == handler_function
            for node in tree.body
        ):
            raise ValueError(f"Lambda handler function is missing: {manifest['handler']}")


def build_package(repository_root: Path, output: Path) -> dict[str, Any]:
    manifest = load_manifest(repository_root)
    source = repository_root / manifest["source"]
    files = source_files(repository_root, manifest)
    validate_sources(repository_root, manifest, files)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            relative = path.relative_to(source).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    payload = output.read_bytes()
    return {
        "output": str(output),
        "files": len(files),
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "handler": manifest["handler"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if args.check_only and args.output:
        parser.error("--check-only and --output cannot be used together")
    if args.check_only:
        with tempfile.TemporaryDirectory(prefix="transitforge-lambda-") as directory:
            result = build_package(REPOSITORY_ROOT, Path(directory) / "agent-api.zip")
    else:
        output = args.output or Path("/tmp/transitforge-agent-api.zip")
        result = build_package(REPOSITORY_ROOT, output)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
