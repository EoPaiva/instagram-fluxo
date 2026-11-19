"""Write-only Chrome Native Messaging sink. Only trusted startup config selects paths."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sqlite3
import struct
import sys
import time
import uuid

PROTOCOL = 1
MAX_FRAME = 256 * 1024
MAX_EVENTS = 64
HOST_NAME = "dev.upaiva.instagram_fluxo.logs"
EXTENSION_ID = "pbhboajbblogfchdgclpfolffnalkaag"
WORKSPACE = Path(__file__).resolve().parents[3]
CONTRACT_FILE = Path(__file__).with_name("diagnostic-contract.json")
if not CONTRACT_FILE.is_file():
    CONTRACT_FILE = Path(__file__).parent.parent / "diagnostic-contract.json"
CONTRACT = json.loads(CONTRACT_FILE.read_text(encoding="utf-8"))
EVENT_FIELDS = {name: set(CONTRACT["commonFields"]) | set(fields) for name, fields in CONTRACT["eventFields"].items()}
ID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z", re.I)
SLUG = re.compile(r"[a-z][a-z0-9_.-]{0,63}\Z", re.I)
HANDLE = re.compile(r"[A-Za-z0-9._]{1,30}\Z")
QA_NAME = re.compile(re.escape(HOST_NAME) + r"\.qa_[a-f0-9]{32}\Z")
SEGMENT = re.compile(r"events-\d{8}T\d{6}-[a-f0-9]{12}\.jsonl\Z")
COUNTS = frozenset("count target processed followed requested skipped observed expected queueLength attempt elapsedMs waitMs nextAt clickBy".split())
BOOLEANS = frozenset(("complete", "enabled", "interrupted"))
SLUGS = frozenset(("phase", "status", "reason", "control"))
ENUMS = {
    "action": frozenset("follow unfollow discovery profile ai settings pacing storage diagnostics".split()),
    "provider": frozenset("openai gemini openrouter claude".split()),
}


class SafeError(Exception):
    """An error code safe to send over the protocol."""


def scrub_message(value: str) -> str:
    # Scrub before truncation so a token cannot become an unrecognizable prefix.
    value = re.sub(r"https?://[^\s<>\"']+", "[redacted-url]", value, flags=re.I)
    value = re.sub(r"\b(?:sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+)\b", "[redacted-secret]", value)
    value = re.sub(r"\b(?:ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[a-z]-[A-Za-z0-9-]+|AKIA[A-Z0-9]+)\b", "[redacted-secret]", value)
    value = re.sub(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)", "[redacted-private-key]", value)
    value = re.sub(r"\bBearer\s+[^\s,;]+", "Bearer [redacted]", value, flags=re.I)
    value = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b", "[redacted-jwt]", value)
    value = re.sub(r"\b(?:api[ _-]?key|authorization|password|passwd|secret|access[ _-]?token|token)\s*[:=]\s*[^\r\n]+", "[redacted-credential]", value, flags=re.I)
    value = "".join(char if char >= " " or char == "\t" else " " for char in value)
    return value[:500]


def integer(value: object, maximum: int = 9007199254740991) -> bool:
    return type(value) is int and 0 <= value <= maximum


def sanitize_event(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise SafeError("invalid_event")
    required = {
        "schemaVersion": raw.get("schemaVersion"), "id": raw.get("id"),
        "timestamp": raw.get("timestamp"), "source": raw.get("source"),
        "level": raw.get("level"), "event": raw.get("event"),
    }
    if (type(required["schemaVersion"]) is not int or required["schemaVersion"] != 1
            or not isinstance(required["id"], str) or not ID.fullmatch(required["id"])
            or not integer(required["timestamp"], 253402300799999)
            or required["source"] not in ("dashboard", "worker", "instagram")
            or required["level"] not in ("info", "warn", "error")
            or not isinstance(required["event"], str) or required["event"] not in EVENT_FIELDS
            or not set(raw).issubset(EVENT_FIELDS[required["event"]])):
        raise SafeError("invalid_event")
    event = required
    for key in ("owner", "username"):
        value = raw.get(key)
        if isinstance(value, str) and HANDLE.fullmatch(value) and value not in {".", ".."} and scrub_message(value) == value:
            if key in raw:
                event[key] = value
    value = raw.get("runId")
    if value is None or isinstance(value, str) and ID.fullmatch(value):
        if "runId" in raw:
            event["runId"] = value
    for key in SLUGS:
        value = raw.get(key)
        if isinstance(value, str) and SLUG.fullmatch(value) and scrub_message(value) == value:
            event[key] = value
    for key, allowed in ENUMS.items():
        value = raw.get(key)
        if isinstance(value, str) and value in allowed:
            event[key] = value
    for key in COUNTS:
        if integer(raw.get(key)):
            event[key] = raw[key]
    for key in BOOLEANS:
        if type(raw.get(key)) is bool:
            event[key] = raw[key]
    if isinstance(raw.get("message"), str):
        event["message"] = scrub_message(raw["message"])
    if set(event) != set(raw):
        raise SafeError("invalid_event")
    return event


def load_config(path: str, workspace: Path = WORKSPACE) -> dict:
    raw = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if not isinstance(raw, dict) or raw.get("protocol") != 1:
        raise SafeError("invalid_config")
    name = raw.get("hostName", "")
    origin = raw.get("allowedOrigin", "")
    if not isinstance(name, str) or not isinstance(origin, str):
        raise SafeError("invalid_config")
    qa = bool(QA_NAME.fullmatch(name))
    if name != HOST_NAME and not qa:
        raise SafeError("invalid_config")
    if not re.fullmatch(r"chrome-extension://[a-p]{32}/", origin):
        raise SafeError("invalid_config")
    workspace = workspace.resolve(strict=True)
    directory = Path(raw.get("logDirectory", "")).resolve()
    default_directory = workspace / "logs" / "instagram-fluxo"
    if not directory.is_relative_to(workspace) or directory == workspace:
        raise SafeError("invalid_config")
    if not qa and (origin != f"chrome-extension://{EXTENSION_ID}/" or directory != default_directory):
        raise SafeError("invalid_config")
    limits = (raw.get("maxSegmentBytes", 5 * 1024 * 1024), raw.get("maxTotalBytes", 256 * 1024 * 1024), raw.get("retentionDays", 90))
    if any(type(value) is not int or value <= 0 for value in limits):
        raise SafeError("invalid_config")
    if limits[0] > 5 * 1024 * 1024 or limits[1] > 256 * 1024 * 1024 or limits[2] > 90 or limits[0] > limits[1]:
        raise SafeError("invalid_config")
    if not qa and limits != (5 * 1024 * 1024, 256 * 1024 * 1024, 90):
        raise SafeError("invalid_config")
    return {"directory": directory, "workspace": workspace, "origin": origin, "segment": limits[0], "total": limits[1], "days": limits[2]}


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


class Journal:
    def __init__(self, config: dict):
        self.config = config
        self.needs_recovery = False
        self.directory = config["directory"]
        self.directory.mkdir(parents=True, exist_ok=True)
        if self.directory.resolve() != self.directory or not self.directory.is_relative_to(config["workspace"]):
            raise SafeError("invalid_config")
        index_path = self.directory / "event-index.sqlite3"
        for path in (index_path, index_path.with_name(index_path.name + "-journal"), self.directory / "status.json"):
            if path.is_symlink() or (path.exists() and not path.is_file()):
                raise SafeError("journal_unavailable")
        self.db = sqlite3.connect(index_path, timeout=4, isolation_level=None)
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, file TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.recover()
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def segments(self) -> list[Path]:
        return sorted((path for path in self.directory.iterdir() if SEGMENT.fullmatch(path.name) and path.is_file() and not path.is_symlink()), key=lambda path: (path.stat().st_mtime_ns, path.name))

    def recover(self) -> None:
        # Reconcile the append-before-index crash window, repairing only an incomplete tail.
        present = set()
        for path in self.segments():
            present.add(path.name)
            key = "size:" + path.name
            offset = int(self.meta(key) or 0)
            size = path.stat().st_size
            if offset > size:
                self.db.execute("DELETE FROM seen WHERE file=?", (path.name,))
                offset = 0
            if offset == size:
                continue
            with path.open("r+b") as stream:
                stream.seek(offset)
                last_good = offset
                while line := stream.readline():
                    try:
                        item = json.loads(line)
                        event_id = item["id"]
                        if not line.endswith(b"\n") or not isinstance(event_id, str) or not ID.fullmatch(event_id):
                            raise ValueError()
                    except (ValueError, KeyError, TypeError, UnicodeError):
                        if stream.read(1):
                            raise SafeError("journal_corrupt")
                        stream.truncate(last_good)
                        stream.flush()
                        os.fsync(stream.fileno())
                        break
                    self.db.execute("INSERT OR IGNORE INTO seen(id,file) VALUES (?,?)", (event_id, path.name))
                    last_good = stream.tell()
            self.set_meta(key, str(last_good))
        for (name,) in self.db.execute("SELECT DISTINCT file FROM seen").fetchall():
            if name not in present:
                self.db.execute("DELETE FROM seen WHERE file=?", (name,))
                self.db.execute("DELETE FROM meta WHERE key=?", ("size:" + name,))

    def meta(self, key: str) -> str | None:
        result = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return result[0] if result else None

    def set_meta(self, key: str, value: str) -> None:
        self.db.execute("INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def append_one(self, event: dict) -> str:
        payload = encoded(event) + b"\n"
        if len(payload) > self.config["segment"]:
            raise SafeError("event_too_large")
        current = self.meta("currentFile")
        path = self.directory / current if current and SEGMENT.fullmatch(current) else None
        if path is None or not path.exists() or path.stat().st_size + len(payload) > self.config["segment"]:
            name = time.strftime("events-%Y%m%dT%H%M%S-", time.gmtime()) + uuid.uuid4().hex[:12] + ".jsonl"
            path = self.directory / name
            self.set_meta("currentFile", name)
        if path.is_symlink():
            raise SafeError("journal_unavailable")
        with path.open("ab") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        self.db.execute("INSERT INTO seen(id,file) VALUES (?,?)", (event["id"], path.name))
        self.set_meta("size:" + path.name, str(path.stat().st_size))
        return path.name

    def prune(self) -> int:
        paths = self.segments()
        total = sum(path.stat().st_size for path in paths)
        cutoff = time.time() - self.config["days"] * 86400
        # Reserve enough space for a small explicit gap record.
        reserve = min(1024, self.config["total"] // 4)
        removed = 0
        for path in paths:
            size = path.stat().st_size
            if path.stat().st_mtime >= cutoff and total <= self.config["total"] - reserve:
                continue
            path.unlink()
            self.db.execute("DELETE FROM seen WHERE file=?", (path.name,))
            self.db.execute("DELETE FROM meta WHERE key=?", ("size:" + path.name,))
            total -= size
            removed += 1
        if removed:
            self.append_one({"schemaVersion": 1, "id": str(uuid.uuid4()), "timestamp": int(time.time() * 1000), "source": "worker", "level": "warn", "event": "diagnostics.retention-pruned", "reason": "retention-limit", "count": removed})
        return removed

    def status(self) -> dict:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            if self.needs_recovery:
                self.recover()
                self.needs_recovery = False
            self.prune()
            result = {"directory": str(self.directory), "file": self.meta("currentFile"), "lastReceiptAt": int(self.meta("lastReceiptAt") or 0), "lastAcceptedCount": int(self.meta("lastAcceptedCount") or 0), "retainedCount": self.db.execute("SELECT count(*) FROM seen").fetchone()[0]}
            self.db.execute("COMMIT")
            return result
        except Exception:
            self.needs_recovery = True
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            raise

    def append(self, events: list[dict]) -> dict:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            if self.needs_recovery:
                self.recover()
                self.needs_recovery = False
            accepted = []
            last_file = self.meta("currentFile")
            for event in events:
                row = self.db.execute("SELECT file FROM seen WHERE id=?", (event["id"],)).fetchone()
                last_file = row[0] if row else self.append_one(event)
                accepted.append(event["id"])
            self.prune()
            received = int(time.time() * 1000)
            self.set_meta("lastReceiptAt", str(received))
            self.set_meta("lastAcceptedCount", str(len(accepted)))
            self.db.execute("COMMIT")
            # status.json is replace-atomic, and is written while holding the same DB lock.
            self.db.execute("BEGIN IMMEDIATE")
            try:
                status = {"protocol": 1, "lastReceiptAt": int(self.meta("lastReceiptAt") or 0), "lastAcceptedCount": int(self.meta("lastAcceptedCount") or 0), "directory": str(self.directory), "file": self.meta("currentFile")}
                temp = self.directory / f".status-{uuid.uuid4().hex}.tmp"
                with temp.open("wb") as stream:
                    stream.write(encoded(status) + b"\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temp, self.directory / "status.json")
                self.db.execute("COMMIT")
            except Exception:
                self.db.execute("ROLLBACK")
                raise
            return {"acceptedIds": accepted, "directory": str(self.directory), "file": last_file}
        except Exception:
            self.needs_recovery = True
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            raise


def read_exact(stream, count: int) -> bytes:
    data = bytearray()
    while len(data) < count:
        chunk = stream.read(count - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


def send(value: dict) -> None:
    payload = encoded(value)
    sys.stdout.buffer.write(struct.pack("=I", len(payload)) + payload)
    sys.stdout.buffer.flush()


def main() -> int:
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", required=True)
    parser.add_argument("--workspace", type=Path, default=WORKSPACE)
    parser.add_argument("origin")
    args, _ = parser.parse_known_args()
    try:
        config = load_config(args.config, args.workspace)
        if args.origin != config["origin"]:
            raise SafeError("forbidden_origin")
        journal = Journal(config)
    except SafeError as error:
        send({"protocol": 1, "ok": False, "code": str(error)})
        return 1
    except Exception:
        send({"protocol": 1, "ok": False, "code": "host_unavailable"})
        return 1
    while True:
        header = read_exact(sys.stdin.buffer, 4)
        if not header:
            return 0
        if len(header) != 4:
            send({"protocol": 1, "ok": False, "code": "malformed_frame"})
            return 1
        size = struct.unpack("=I", header)[0]
        if not 0 < size <= MAX_FRAME:
            send({"protocol": 1, "ok": False, "code": "frame_too_large"})
            return 1
        payload = read_exact(sys.stdin.buffer, size)
        if len(payload) != size:
            send({"protocol": 1, "ok": False, "code": "malformed_frame"})
            return 1
        request_id = None
        writing = False
        try:
            raw = json.loads(payload)
            if not isinstance(raw, dict) or type(raw.get("protocol")) is not int or raw.get("protocol") != 1:
                raise SafeError("invalid_request")
            candidate_id = raw.get("requestId")
            if not isinstance(candidate_id, str) or str(uuid.UUID(candidate_id)) != candidate_id.lower():
                raise SafeError("invalid_request")
            request_id = candidate_id
            if raw.get("type") == "append" and set(raw) == {"protocol", "type", "requestId", "events"}:
                if not isinstance(raw["events"], list) or not 1 <= len(raw["events"]) <= MAX_EVENTS:
                    raise SafeError("invalid_batch")
                events = [sanitize_event(item) for item in raw["events"]]
                writing = True
                result = journal.append(events)
            elif raw.get("type") == "status" and set(raw) == {"protocol", "type", "requestId"}:
                writing = True
                result = journal.status()
            else:
                raise SafeError("unsupported_request")
            send({"protocol": 1, "ok": True, "requestId": request_id, **result})
        except SafeError as error:
            if writing:
                send({"protocol": 1, "ok": False, "requestId": request_id, "code": "write_failed"})
                journal.db.close()
                return 1
            send({"protocol": 1, "ok": False, "requestId": request_id, "code": str(error)})
        except (ValueError, TypeError, UnicodeError):
            if writing:
                send({"protocol": 1, "ok": False, "requestId": request_id, "code": "write_failed"})
                journal.db.close()
                return 1
            send({"protocol": 1, "ok": False, "requestId": request_id, "code": "invalid_request"})
        except Exception:
            send({"protocol": 1, "ok": False, "requestId": request_id, "code": "write_failed"})
            journal.db.close()
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
