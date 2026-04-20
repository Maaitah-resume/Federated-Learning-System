# fl_server/core/round_controller.py
# Holds the in-memory global model weights for each active job.
# Node.js drives the round lifecycle — this class only stores state.

from typing import Dict, Optional
import threading
from core.model_manager import (
    build_fresh_model,
    serialize_weights,
    deserialize_weights,
    count_parameters,
)


class RoundController:
    """
    Stores the current global model state_dict for each active job.

    Structure:
        _jobs = {
            "{job_id}": {
                "state_dict":    { layer: tensor, ... },
                "model_version": str,
                "current_round": int,
            },
            ...
        }
    """

    def __init__(self):
        self._jobs: Dict[str, dict] = {}
        self._lock = threading.Lock()

    # ── Initialise ────────────────────────────────────────────────────────────

    def initialize(self, job_id: str, model_version: str) -> dict:
        """
        Creates a fresh model for a new training job.
        Returns serialised weights + metadata for Node.js.
        """
        model      = build_fresh_model()
        state_dict = model.state_dict()

        with self._lock:
            self._jobs[job_id] = {
                "state_dict":    state_dict,
                "model_version": model_version,
                "current_round": 0,
            }

        return {
            "weights_b64":        serialize_weights(state_dict),
            "model_architecture": model_version,
            "num_params":         count_parameters(model),
        }

    # ── Get weights ───────────────────────────────────────────────────────────

    def get_weights_b64(self, job_id: str) -> Optional[str]:
        """Returns the current global model weights as a base64 string."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            return serialize_weights(job["state_dict"])

    def get_state_dict(self, job_id: str) -> Optional[dict]:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job["state_dict"]) if job else None

    # ── Update weights ────────────────────────────────────────────────────────

    def update_weights(self, job_id: str, new_state_dict: dict, round_number: int) -> None:
        """Replaces the global model with the aggregated state_dict."""
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id]["state_dict"]    = new_state_dict
                self._jobs[job_id]["current_round"] = round_number

    # ── Status ────────────────────────────────────────────────────────────────

    def get_round(self, job_id: str) -> int:
        with self._lock:
            return self._jobs.get(job_id, {}).get("current_round", 0)

    def job_exists(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._jobs

    # ── Cleanup ───────────────────────────────────────────────────────────────

    def cleanup(self, job_id: str) -> None:
        """Removes job from memory after training completes."""
        with self._lock:
            self._jobs.pop(job_id, None)


# Module-level singleton
round_controller = RoundController()