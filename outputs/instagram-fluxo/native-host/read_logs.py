"""Read sanitized local JSONL files; never contacts Chrome or any network service."""
from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path

DEFAULT_DIRECTORY = Path(__file__).resolve().parents[3] / "logs" / "instagram-fluxo"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--today", action="store_true", help="Use the computer's local calendar date")
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY, help="Explicit local diagnostic folder (for QA/archived logs)")
    args = parser.parse_args()
    seen = set()
    today = datetime.now().astimezone().date()
    directory = args.directory.resolve()
    if not directory.exists():
        return 0
    for path in sorted(directory.glob("events-*.jsonl")):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    event = json.loads(line)
                    event_id = event.get("id")
                    if not isinstance(event_id, str) or event_id in seen:
                        continue
                    if args.today and datetime.fromtimestamp(event["timestamp"] / 1000).astimezone().date() != today:
                        continue
                    seen.add(event_id)
                    print(json.dumps(event, ensure_ascii=False, separators=(",", ":")))
                except (ValueError, TypeError, KeyError, OverflowError, OSError):
                    continue
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
