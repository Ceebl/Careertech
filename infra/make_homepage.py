#!/usr/bin/env python3
"""Write the site homepage listing the deployed projects.

Run during deploy, after the project folders have been synced:

    make_homepage.py --list <file of folder names> --out /var/www/html/index.html

Generated rather than hand-written so it always matches what is actually on the
server -- add or delete a project folder and the homepage follows automatically.
"""

import argparse
import html
from datetime import datetime, timezone
from pathlib import Path

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>emaitch.co.uk</title>
<style>
  :root {{
    color-scheme: light dark;
    --bg: #ffffff; --fg: #16181d; --muted: #6b7280;
    --line: #e5e7eb; --card: #f9fafb; --accent: #2563eb;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #0f1115; --fg: #e8e8e8; --muted: #9ca3af;
      --line: #262b35; --card: #161a22; --accent: #60a5fa;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 3rem 1.25rem; background: var(--bg); color: var(--fg);
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  }}
  main {{ max-width: 42rem; margin: 0 auto; }}
  h1 {{ font-size: 1.6rem; margin: 0 0 .25rem; letter-spacing: -.01em; }}
  .sub {{ color: var(--muted); margin: 0 0 2.5rem; }}
  ul {{ list-style: none; padding: 0; margin: 0; display: grid; gap: .6rem; }}
  a.card {{
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; padding: .9rem 1.1rem; text-decoration: none; color: inherit;
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  }}
  a.card:hover, a.card:focus-visible {{ border-color: var(--accent); }}
  a.card:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 2px; }}
  .name {{ font-weight: 600; }}
  .arrow {{ color: var(--muted); }}
  .empty {{
    padding: 1.5rem; border: 1px dashed var(--line);
    border-radius: 10px; color: var(--muted);
  }}
  footer {{
    margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
    color: var(--muted); font-size: .85rem;
    display: flex; flex-wrap: wrap; gap: .5rem 1rem; justify-content: space-between;
  }}
  footer a {{ color: var(--muted); }}
</style>
</head>
<body>
<main>
  <h1>emaitch.co.uk</h1>
  <p class="sub">A few small things I'm building.</p>

  {body}

  <footer>
    <span>Updated {updated}</span>
    <a href="/api/health">server status</a>
  </footer>
</main>
</body>
</html>
"""


# How a folder should read on the homepage, where the folder name on its own is
# too terse or too cryptic. The folder name is the URL and never changes -- this
# only affects the label. Anything not listed here shows its folder name as-is.
DISPLAY_NAMES = {
    "ctt": "CareerTech Tools",
}


def label_for(name):
    return DISPLAY_NAMES.get(name, name)


def build(names):
    if not names:
        return '<p class="empty">Nothing deployed yet.</p>'

    items = []
    for name in names:
        href = html.escape(name, quote=True)
        label = html.escape(label_for(name), quote=True)
        items.append(
            f'    <li><a class="card" href="/{href}/">'
            f'<span class="name">{label}</span>'
            f'<span class="arrow" aria-hidden="true">&rarr;</span></a></li>'
        )
    return "<ul>\n" + "\n".join(items) + "\n  </ul>"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", required=True, help="file of folder names, one per line")
    parser.add_argument("--out", required=True, help="where to write index.html")
    parser.add_argument(
        "--hide",
        default="",
        help="space-separated folders to publish but leave off the homepage",
    )
    args = parser.parse_args()

    # Shared assets and support folders are still served -- other pages load
    # their CSS -- they just are not projects a visitor would click into.
    hidden = set(args.hide.split())

    # Sorted by the label a visitor actually sees, not the folder behind it.
    names = sorted(
        (
            line.strip()
            for line in Path(args.list).read_text().splitlines()
            if line.strip() and line.strip() not in hidden
        ),
        key=lambda n: label_for(n).lower(),
    )

    page = PAGE.format(
        body=build(names),
        updated=datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC"),
    )
    Path(args.out).write_text(page, encoding="utf-8", newline="\n")
    print(f"homepage written with {len(names)} project(s)")


if __name__ == "__main__":
    main()
