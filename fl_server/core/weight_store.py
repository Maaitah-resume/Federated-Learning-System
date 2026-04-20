# fl_server/core/weight_store.py
# In-memory buffer for per-round weight collection.
# Extended to carry validation_loss and company_id alongside weights
# so the meta-aggregator can compute adaptive trust scores.

from typing import Dict, List, Optional
import threading


class WeightStore:
    """
    Thread-safe in-memory store for federated weight updates.

    Structure:
        _store = {
            "{job_id}:{round}": {
                "{company_id}": {
                    "company_id":      str,
                    "weights":         state_dict,   # masked in hybrid mode
                    "dataset_size":    int,
                    "validation_loss": float | None, # NEW: for meta-weighting
                },
                ...
            }
        }
    """

    def __init__(self):
        self._store: Dict[str, Dict] = {}
        self._lock  = threading.Lock()

    def _key(self, job_id: str, round_number: int) -> str:
        return f"{job_id}:{round_number}"

    def store(
        self,
        job_id:           str,
        round_number:     int,
        company_id:       str,
        weights:          dict,
        dataset_size:     int,
        validation_loss:  Optional[float] = None,  # NEW field
    ) -> None:
        key = self._key(job_id, round_number)
        with self._lock:
            if key not in self._store:
                self._store[key] = {}
            self._store[key][company_id] = {
                "company_id":      company_id,
                "weights":         weights,
                "dataset_size":    dataset_size,
                "validation_loss": validation_loss,  # passed to meta-aggregator
            }

    def get_all(self, job_id: str, round_number: int) -> List[dict]:
        """Returns list of full update dicts for aggregation."""
        key = self._key(job_id, round_number)
        with self._lock:
            return list(self._store.get(key, {}).values())

    def count(self, job_id: str, round_number: int) -> int:
        key = self._key(job_id, round_number)
        with self._lock:
            return len(self._store.get(key, {}))

    def clear(self, job_id: str, round_number: int) -> None:
        key = self._key(job_id, round_number)
        with self._lock:
            self._store.pop(key, None)

    def clear_job(self, job_id: str) -> None:
        prefix = f"{job_id}:"
        with self._lock:
            for k in [k for k in self._store if k.startswith(prefix)]:
                del self._store[k]


weight_store = WeightStore()