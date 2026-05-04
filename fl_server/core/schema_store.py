# fl_server/core/schema_store.py
import threading
from typing import Dict, Optional


class SchemaStore:
    """
    Stores the dataset schema for each active job.
    First participant defines the schema, rest must match.
    """
    def __init__(self):
        self._schemas: Dict[str, dict] = {}
        self._lock = threading.Lock()

    def set(self, job_id: str, schema: dict) -> None:
        with self._lock:
            self._schemas[job_id] = schema

    def get(self, job_id: str) -> Optional[dict]:
        with self._lock:
            return self._schemas.get(job_id)

    def has(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._schemas

    def clear(self, job_id: str) -> None:
        with self._lock:
            self._schemas.pop(job_id, None)


schema_store = SchemaStore()
