# fl_server/api/routes/training.py
#
# FastAPI router for all FL training lifecycle endpoints.
# Called by the Node.js backend to orchestrate federated rounds.
#
# Endpoints:
#   POST /initialize        — create a fresh model for a new job
#   POST /distribute        — return current global weights for a round
#   POST /receive-weights   — accept one node's masked weight update
#   POST /aggregate         — aggregate all weights for a round
#   POST /finalize          — save final model, clean up job state
#   GET  /status/{job_id}   — health/progress check for a job

import base64
import os

from fastapi import APIRouter, HTTPException

from api.schemas.requests import (
    InitializeRequest,
    DistributeRequest,
    ReceiveWeightsRequest,
    AggregateRequest,
    FinalizeRequest,
)
from core.round_controller import round_controller
from core.weight_store      import weight_store
from core.aggregator        import aggregate, compute_metrics
from core.model_manager     import (
    serialize_weights,
    deserialize_weights,
    save_model_to_disk,
    count_parameters,
)
from core.schema_store      import schema_store

# ── Router ────────────────────────────────────────────────────────────────────
router = APIRouter()


# ── POST /initialize ──────────────────────────────────────────────────────────

@router.post("/initialize")
def initialize(req: InitializeRequest):
    """
    Creates a fresh model for a new training job.
    If a sample CSV (base64) is provided, auto-detects the schema
    (feature count, target column, binary vs. multi-class).
    Otherwise falls back to a safe default (25 features, binary).
    """
    job_id        = req.job_id
    model_version = req.model_version

    # ── Schema detection ──────────────────────────────────────────────────────
    if req.sample_csv_b64:
        try:
            from core.data_engineer import analyze_csv
            csv_bytes = base64.b64decode(req.sample_csv_b64.encode())
            schema    = analyze_csv(csv_bytes)
            schema_store.set(job_id, schema)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Schema analysis failed: {exc}",
            )
    else:
        # Safe default — 25 features, binary classification
        schema = {"input_dim": 25, "output_dim": 1, "is_binary": True}
        schema_store.set(job_id, schema)

    # ── Build model with detected dimensions ──────────────────────────────────
    from models.ids_model import build_model

    input_dim  = schema.get("input_dim",  25)
    output_dim = schema.get("output_dim", 1)
    model      = build_model(input_dim=input_dim, output_dim=output_dim)
    state_dict = model.state_dict()

    # Store in round_controller (in-memory)
    round_controller._jobs[job_id] = {
        "state_dict":    state_dict,
        "model_version": model_version,
        "current_round": 0,
    }

    return {
        "job_id":             job_id,
        "weights_b64":        serialize_weights(state_dict),
        "model_architecture": model_version,
        "num_params":         count_parameters(model),
        "schema": {
            "input_dim":  input_dim,
            "output_dim": output_dim,
            "is_binary":  schema.get("is_binary", True),
            "target_col": schema.get("target_col"),
        },
    }


# ── POST /distribute ──────────────────────────────────────────────────────────

@router.post("/distribute")
def distribute(req: DistributeRequest):
    """
    Returns the current global model weights for a round so that Node.js
    can broadcast them to all participating nodes.
    """
    weights_b64 = round_controller.get_weights_b64(req.job_id)

    if weights_b64 is None:
        raise HTTPException(
            status_code=404,
            detail=f"Job '{req.job_id}' not found. Call /initialize first.",
        )

    return {
        "job_id":      req.job_id,
        "round":       req.round,
        "weights_b64": weights_b64,
    }


# ── POST /receive-weights ─────────────────────────────────────────────────────

@router.post("/receive-weights")
def receive_weights(req: ReceiveWeightsRequest):
    """
    Accepts one node's (optionally masked) weight update for a round.
    Stores it in the in-memory weight_store until all nodes have submitted.
    """
    if not round_controller.job_exists(req.job_id):
        raise HTTPException(
            status_code=404,
            detail=f"Job '{req.job_id}' not found.",
        )

    try:
        state_dict = deserialize_weights(req.weights_b64)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to deserialize weights: {exc}",
        )

    weight_store.store(
        job_id          = req.job_id,
        round_number    = req.round,
        company_id      = req.company_id,
        weights         = state_dict,
        dataset_size    = req.dataset_size,
        validation_loss = req.validation_loss,
    )

    count = weight_store.count(req.job_id, req.round)

    return {
        "received":   True,
        "job_id":     req.job_id,
        "round":      req.round,
        "company_id": req.company_id,
        "stored":     count,
    }


# ── POST /aggregate ───────────────────────────────────────────────────────────

@router.post("/aggregate")
def aggregate_round(req: AggregateRequest):
    """
    Aggregates all weight updates submitted for a round and stores the
    new global model. Clears the per-round weight buffer afterwards.
    Supports mode_override to switch between 'hybrid', 'meta', 'fedavg'.
    """
    if not round_controller.job_exists(req.job_id):
        raise HTTPException(
            status_code=404,
            detail=f"Job '{req.job_id}' not found.",
        )

    updates = weight_store.get_all(req.job_id, req.round)

    if not updates:
        raise HTTPException(
            status_code=400,
            detail=f"No weights received for job '{req.job_id}' round {req.round}.",
        )

    # Snapshot current weights for metrics comparison
    before_state = round_controller.get_state_dict(req.job_id) or {}

    try:
        # aggregate() returns the new state_dict directly (not a tuple)
        new_state_dict = aggregate(updates, round_number=req.round)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Aggregation failed: {exc}",
        )

    round_controller.update_weights(req.job_id, new_state_dict, req.round)
    weight_store.clear(req.job_id, req.round)

    # Compute aggregation metadata (delta, trust scores, etc.)
    agg_meta = compute_metrics(before_state, new_state_dict, updates)

    return {
        "aggregated":       True,
        "job_id":           req.job_id,
        "round":            req.round,
        "participants":     len(updates),
        "weights_b64":      serialize_weights(new_state_dict),
        "aggregation_meta": agg_meta,
    }


# ── POST /finalize ────────────────────────────────────────────────────────────

@router.post("/finalize")
def finalize(req: FinalizeRequest):
    """
    Saves the final global model to disk and cleans up all in-memory state
    for the job. Returns the model path, checksum, and size.
    """
    if not round_controller.job_exists(req.job_id):
        raise HTTPException(
            status_code=404,
            detail=f"Job '{req.job_id}' not found.",
        )

    state_dict = round_controller.get_state_dict(req.job_id)
    if state_dict is None:
        raise HTTPException(status_code=500, detail="Could not retrieve model state.")

    model_dir = os.environ.get("MODEL_STORE_PATH", "/tmp/models")
    model_path = os.path.join(model_dir, f"{req.job_id}_final.pt")

    try:
        checksum, size_bytes = save_model_to_disk(state_dict, model_path)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save model: {exc}",
        )

    # Clean up in-memory state
    round_controller.cleanup(req.job_id)
    weight_store.clear_job(req.job_id)
    schema_store.clear(req.job_id)

    return {
        "finalized":   True,
        "job_id":      req.job_id,
        "model_path":  model_path,
        "checksum":    checksum,
        "size_bytes":  size_bytes,
        "weights_b64": serialize_weights(state_dict),
    }


# ── GET /status/{job_id} ──────────────────────────────────────────────────────

@router.get("/status/{job_id}")
def status(job_id: str):
    """Returns current state of an active training job."""
    if not round_controller.job_exists(job_id):
        raise HTTPException(
            status_code=404,
            detail=f"Job '{job_id}' not found.",
        )

    return {
        "job_id":        job_id,
        "current_round": round_controller.get_round(job_id),
        "active":        True,
        "schema":        schema_store.get(job_id),
    }
