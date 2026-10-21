import argparse
import json
import logging
import os
import time
from contextlib import contextmanager

from backend.analysis.features import extract
from backend.app import storage as s

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("favescape.worker")


@contextmanager
def worker_lock():
    s.DATA.mkdir(parents=True, exist_ok=True)
    with (s.DATA / "worker.lock").open("a+b") as lock:
        lock.seek(0, os.SEEK_END)
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise RuntimeError("A Favescape worker is already running for this data directory.") from exc
        else:
            import fcntl
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise RuntimeError("A Favescape worker is already running for this data directory.") from exc
        try:
            yield
        finally:
            lock.seek(0)
            if os.name == "nt":
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def recover():
    with s.connect() as conn:
        conn.execute("UPDATE jobs SET state='queued',updated_at=? WHERE state='running'", (s.now(),))
        for row in conn.execute("SELECT DISTINCT track_id FROM jobs WHERE state='queued'"):
            track_row = s.raw_track(conn, row[0])
            if track_row:
                track = json.loads(track_row["payload"])
                track["analysisStatus"] = "pending"
                s.save_track(conn, track)


def work_one():
    with s.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        job = conn.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at LIMIT 1").fetchone()
        if not job:
            return False
        job = dict(job)
        row = s.raw_track(conn, job["track_id"])
        if not row:
            conn.execute("DELETE FROM jobs WHERE id=?", (job["id"],))
            return True
        path = s.safe_audio_path(row["storage_name"])
        track = json.loads(row["payload"])
        track["analysisStatus"] = "running"
        track["analysisError"] = None
        s.save_track(conn, track)
        conn.execute("UPDATE jobs SET state='running',attempts=attempts+1,updated_at=? WHERE id=?", (s.now(), job["id"]))
    try:
        if not path:
            raise ValueError("Audio is missing; import the original file to relink it.")
        features = extract(path)
        with s.connect() as conn:
            row = s.raw_track(conn, job["track_id"])
            if row:
                track = json.loads(row["payload"])
                track.update(features=features, analysisStatus="ready", analysisError=None)
                s.save_track(conn, track)
            conn.execute("UPDATE jobs SET state='succeeded',error=NULL,updated_at=? WHERE id=?", (s.now(), job["id"]))
        log.info("Analyzed track %s", job["track_id"])
    except Exception as exc:
        error = "This audio could not be analyzed by the local decoder. Playback may still work; try a WAV, MP3, or FLAC copy."
        if isinstance(exc, ValueError):
            error = str(exc)
        with s.connect() as conn:
            row = s.raw_track(conn, job["track_id"])
            if row:
                track = json.loads(row["payload"])
                track.update(analysisStatus="failed", analysisError=error)
                s.save_track(conn, track)
            conn.execute("UPDATE jobs SET state='failed',error=?,updated_at=? WHERE id=?", (error, s.now(), job["id"]))
        log.warning("Analysis failed for track %s: %s", job["track_id"], type(exc).__name__)
    return True


def main():
    parser = argparse.ArgumentParser(description="Process Favescape's persisted audio analysis jobs.")
    parser.add_argument("--once", action="store_true", help="Process currently queued work and exit.")
    args = parser.parse_args()
    s.initialize()
    with worker_lock():
        recover()
        log.info("Local audio feature worker ready.")
        while True:
            if not work_one():
                if args.once:
                    return
                time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
