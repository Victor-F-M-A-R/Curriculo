import contextlib
import json
import os
import sqlite3
import time
import uuid


def connect():
    db = sqlite3.connect(os.environ.get("FAROL_DB", "farol.db"), timeout=8)
    db.row_factory = sqlite3.Row
    db.execute("pragma foreign_keys=on")
    return db


@contextlib.contextmanager
def connection():
    db = connect()
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize():
    with connection() as db:
        db.execute("pragma journal_mode=wal")
        db.executescript("""
          create table if not exists runs(
            id text primary key, session text not null, question text not null, result text not null, created real not null
          );
          create index if not exists runs_by_session on runs(session,created);
          create table if not exists reviews(
            id text primary key, run_id text unique not null references runs(id) on delete cascade,
            delivery text not null, attempts integer not null default 0, next_at real not null default 0
          );
          create index if not exists runs_by_created on runs(created);
          create view if not exists visible_runs as
            select * from runs where created >= (strftime('%s','now') - 604800)
            or exists(select 1 from reviews where run_id=runs.id and delivery in ('queued','sending'));
        """)


def save(session, question, result):
    ident = uuid.uuid4().hex
    with connection() as db:
        db.execute(
            "insert into runs values(?,?,?,?,?)",
            (
                ident,
                session,
                question,
                json.dumps(result, ensure_ascii=False),
                time.time(),
            ),
        )
        # The operator controls local history. Bound disk usage for abandoned sessions as well.
        db.execute(
            "delete from runs where created < ? and id not in (select run_id from reviews where delivery in ('queued','sending'))",
            (time.time() - 7 * 86400,),
        )
    return ident


def list_runs(session):
    with connection() as db:
        return [
            dict(r)
            for r in db.execute(
                "select id,question,created from visible_runs where session=? order by created desc limit 30",
                (session,),
            )
        ]


def get(session, ident):
    with connection() as db:
        row = db.execute(
            """select r.*,v.delivery from visible_runs r left join reviews v on v.run_id=r.id
                          where r.session=? and r.id=?""",
            (session, ident),
        ).fetchone()
    if row:
        return json.loads(row["result"]) | {
            "id": ident,
            "question": row["question"],
            "delivery": row["delivery"],
        }


def review(session, ident, webhook):
    with connection() as db:
        # Scope the insert itself so a concurrent history deletion cannot leave
        # a pending review for a run that has disappeared.
        db.execute(
            """insert into reviews(id,run_id,delivery)
               select ?,id,? from visible_runs where session=? and id=?
               on conflict(run_id) do nothing""",
            (uuid.uuid4().hex, "queued" if webhook else "local", session, ident),
        )
        row = db.execute(
            """select reviews.delivery from reviews join visible_runs r on r.id=reviews.run_id
               where r.session=? and r.id=?""", (session, ident)
        ).fetchone()
        return row["delivery"] if row else None


def claim():
    now = time.time()
    with connection() as db:
        db.execute("begin immediate")
        item = db.execute(
            """select id,run_id,attempts from reviews where delivery in ('queued','sending') and next_at<=?
                           order by next_at,id limit 1""",
            (now,),
        ).fetchone()
        if not item:
            return None
        db.execute(
            "update reviews set delivery='sending',attempts=attempts+1,next_at=? where id=?",
            (now + 45, item["id"]),
        )
        return dict(item)


def finish(item, success):
    attempts = item["attempts"] + 1
    state = "delivered" if success else ("failed" if attempts >= 6 else "queued")
    with connection() as db:
        db.execute(
            "update reviews set delivery=?,next_at=? where id=? and attempts=?",
            (state, time.time() + min(2**attempts, 300), item["id"], attempts),
        )
