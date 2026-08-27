#!/usr/bin/env python3
"""Add a snippet include line to the HTTPS server block, once.

nginx has no drop-in mechanism for adding a location to an existing server
block, so this finds the right block and inserts a single include line. It is
idempotent: running it again when the line is already present does nothing.

The caller is expected to run `nginx -t` afterwards and restore the backup this
script reports if the test fails.

Usage:
    sudo python3 wire_nginx.py [--domain emaitch.co.uk] [--dry-run]
    sudo python3 wire_nginx.py --include /etc/nginx/snippets/careertech-tasks.conf

Each project that runs in its own container gets its own snippet and its own
run of this script, so the includes are independent -- adding one cannot
disturb another.
"""

import argparse
import shutil
import sys
import time
from pathlib import Path

DEFAULT_INCLUDE = "/etc/nginx/snippets/careertech-api.conf"
SEARCH_DIRS = ["/etc/nginx/sites-available", "/etc/nginx/conf.d"]


def strip_comment(line):
    """Drop a trailing # comment so its braces are not counted."""
    hash_at = line.find("#")
    return line if hash_at < 0 else line[:hash_at]


def server_blocks(lines):
    """Yield (start_index, end_index) for each top-level `server { ... }` block."""
    depth = 0
    start = None
    for i, raw in enumerate(lines):
        line = strip_comment(raw)
        if start is None and depth == 0 and line.strip().startswith("server") and "{" in line:
            start = i
        if start is not None:
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                yield start, i
                start = None
                depth = 0


def is_https_block_for(lines, start, end, domain):
    body = "\n".join(strip_comment(line) for line in lines[start:end + 1])
    listens_443 = any(
        "listen" in line and "443" in line
        for line in body.splitlines()
    )
    names_domain = any(
        line.strip().startswith("server_name") and domain in line
        for line in body.splitlines()
    )
    return listens_443 and names_domain


def indent_of(line):
    return line[:len(line) - len(line.lstrip())]


def wire(path, domain, dry_run, include_path):
    """Return True if the file was changed (or would be)."""
    lines = path.read_text().splitlines()

    for start, end in server_blocks(lines):
        if not is_https_block_for(lines, start, end, domain):
            continue

        block = "\n".join(lines[start:end + 1])
        if include_path in block:
            print(f"already wired: {path}")
            return False

        inner_indent = indent_of(lines[start]) + "    "
        lines.insert(start + 1, f"{inner_indent}include {include_path};")

        if dry_run:
            print(f"would insert into {path} after line {start + 1}")
            return True

        backup = path.with_suffix(path.suffix + f".bak.{int(time.time())}")
        shutil.copy2(path, backup)
        path.write_text("\n".join(lines) + "\n", newline="\n")
        print(f"wired: {path}")
        print(f"backup: {backup}")
        return True

    return None  # no matching block in this file


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--domain", default="emaitch.co.uk")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--search-dir", action="append", default=None)
    parser.add_argument("--include", default=DEFAULT_INCLUDE,
                        help="path of the snippet to include")
    args = parser.parse_args()

    search_dirs = args.search_dir or SEARCH_DIRS
    candidates = []
    for directory in search_dirs:
        base = Path(directory)
        if base.is_dir():
            candidates.extend(sorted(p for p in base.iterdir() if p.is_file()))

    for path in candidates:
        try:
            result = wire(path, args.domain, args.dry_run, args.include)
        except (OSError, UnicodeDecodeError) as err:
            print(f"skipping {path}: {err}", file=sys.stderr)
            continue
        if result is not None:
            return 0  # found the block, wired or already wired

    print(
        f"ERROR: no HTTPS server block for {args.domain} found in "
        f"{', '.join(search_dirs)}",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
