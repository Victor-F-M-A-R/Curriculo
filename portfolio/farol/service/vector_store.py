"""Keep the operator-approved corpus in a SQLite KNN index, shared safely by request threads."""

import hashlib
import sqlite3
import threading

import numpy as np
import sqlite_vec


class VectorStore:
    def __init__(self, vectors, path=":memory:"):
        self.lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False, timeout=15)
        self.db.enable_load_extension(True)
        try:
            sqlite_vec.load(self.db)
        finally:
            self.db.enable_load_extension(False)
        packed = [np.asarray(row.toarray(), dtype="<f4").tobytes() for row in vectors]
        digest = hashlib.sha256(b"".join(packed)).hexdigest()
        with self.db:
            self.db.execute("begin immediate")
            self.db.execute(
                "create table if not exists index_version (id integer primary key, hash text not null)"
            )
            old = self.db.execute(
                "select hash from index_version where id=1"
            ).fetchone()
            if not old or old[0] != digest:
                self.db.execute("drop table if exists excerpts")
                dimensions = vectors.shape[1]
                self.db.execute(
                    f"create virtual table excerpts using vec0(embedding float[{dimensions}] distance_metric=cosine)"
                )
                self.db.executemany(
                    "insert into excerpts(rowid,embedding) values(?,?)",
                    enumerate(packed, 1),
                )
                self.db.execute(
                    "insert or replace into index_version values(1,?)", (digest,)
                )

    def rank(self, vector, limit):
        if not vector.nnz:
            return []
        data = np.asarray(vector.toarray(), dtype="<f4").tobytes()
        with self.lock:
            rows = self.db.execute(
                "select rowid,distance from excerpts where embedding match ? and k=? order by distance",
                (data, limit),
            ).fetchall()
        return [(key - 1, 1 - distance) for key, distance in rows]
