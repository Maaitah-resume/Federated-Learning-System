# fl_server/api/routes/training.py
import os
from fastapi import APIRouter, HTTPException

from api.schemas.requests  import (
    InitializeRequest, DistributeRequest,
    ReceiveWeightsRequest, AggregateRequest, FinalizeRequest,
)
from api.schemas.responses import (
    InitializeResponse, DistributeResponse,
    ReceiveWeightsResponse, AggregateResponse,
    AggregationMetrics, FinalizeResponse, StatusResponse,
)
from core.round_controller import round_controller
from core.weight_store     import weight_store
from core.aggregator       import (
    aggregate, compute_metrics,
    get_trust_scores, AGGREGATION_MODE,
)
from core.model_manager    import (
    deserialize_weights, serialize_weights, save_model_to_disk,
)

router    = APIRouter(prefix="/fl")
MODEL_DIR = os.environ.get("MODEL_STORE_PATH", "./models")


# ── POST /fl/initialize ────────────────────────────────────────────────────────

@router.post("/initialize", response_model=InitializeResponse)
def initialize(req: InitializeRequest):
    """Creates a fresh global model for a new training job."""
    result = round_controller.initialize(req.job_id, req.model_version)
    return InitializeResponse(**result)


# ── POST /fl/distribute ────────────────────────────────────────────────────────

@router.post("/distribute", response_model=DistributeResponse)
def distribute(req: DistributeRequest):
    """Returns current global model weights for a round."""
    weights_b64 = round_controller.get_weights_b64(req.job_id)
    if weights_b64 is None:
        raise HTTPException(
            status_code=404,
            detail=f"Job {req.job_id} not found. Call /fl/initialize first.",
        )
    return DistributeResponse(
        round_model_b64=weights_b64,
        round_id=f"{req.job_id}_round_{req.round}",
    )


# ── POST /fl/receive-weights ──────────────────────────────────────────────────

@router.post("/receive-weights", response_model=ReceiveWeightsResponse)
def receive_weights(req: ReceiveWeightsRequest):
    """
    Buffers one company's weight update.
    Accepts both masked (hybrid mode) and raw (meta/fedavg mode) weights.
    Stores validation_loss for meta-aggregator adaptive scoring.
    """
    try:
        state_dict = deserialize_weights(req.weights_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid weights payload: {e}")

    weight_store.store(
        job_id=req.job_id,
        round_number=req.round,
        company_id=req.company_id,
        weights=state_dict,
        dataset_size=req.dataset_size,
        validation_loss=req.validation_loss,   # NEW: passed to meta-aggregator
    )

    submitted = weight_store.count(req.job_id, req.round)

    return ReceiveWeightsResponse(received=True, waiting_for=max(0, 0))


# ── POST /fl/aggregate ────────────────────────────────────────────────────────

@router.post("/aggregate", response_model=AggregateResponse)
def run_aggregate(req: AggregateRequest):
    """
    Runs the configured aggregation algorithm on all buffered updates.

    Supports three modes via AGGREGATION_MODE env var (or per-request override):
      hybrid  — pairwise mask cancellation + meta-weighted average (default)
      meta    — adaptive meta-weighting on raw weights, no masking
      fedavg  — original FedAvg, dataset-size weighted average

    Returns the new global model weights and per-client α scores.
    """
    updates = weight_store.get_all(req.job_id, req.round)

    if not updates:
        raise HTTPException(
            status_code=400,
            detail=f"No weights found for job {req.job_id} round {req.round}.",
        )

    # Allow per-request mode override (useful for A/B testing rounds)
    mode = req.mode_override or AGGREGATION_MODE
    if req.mode_override:
        # Temporarily patch the env var so aggregate() uses the override
        original = os.environ.get("AGGREGATION_MODE", "hybrid")
        os.environ["AGGREGATION_MODE"] = req.mode_override

    # Snapshot global weights BEFORE aggregation (for delta metrics)
    before_state = round_controller.get_state_dict(req.job_id) or {}

    try:
        # ── Core aggregation call — dispatches to hybrid / meta / fedavg ─────
        aggregated = aggregate(updates, round_number=req.round)
    finally:
        if req.mode_override:
            os.environ["AGGREGATION_MODE"] = original

    # Update global model in memory
    round_controller.update_weights(req.job_id, aggregated, req.round)

    # Compute metrics (includes α scores and trust registry)
    metrics_dict = compute_metrics(before_state, aggregated, updates)

    # Clear weight buffer — raw / masked weights never persist after aggregation
    weight_store.clear(req.job_id, req.round)

    return AggregateResponse(
        aggregated_weights_b64=serialize_weights(aggregated),
        metrics=AggregationMetrics(
            avg_loss=metrics_dict.get("avg_loss"),
            delta_accuracy=metrics_dict.get("delta_accuracy"),
            alpha_scores=metrics_dict.get("alpha_scores"),   # NEW
            trust_scores=metrics_dict.get("trust_scores"),   # NEW
            mode=metrics_dict.get("mode"),                   # NEW
        ),
    )


# ── POST /fl/finalize ─────────────────────────────────────────────────────────

@router.post("/finalize", response_model=FinalizeResponse)
def finalize(req: FinalizeRequest):
    """Saves global_model.pt to the shared Docker volume."""
    state_dict = round_controller.get_state_dict(req.job_id)
    if state_dict is None:
        raise HTTPException(
            status_code=404,
            detail=f"Job {req.job_id} not found or already finalised.",
        )

    save_path            = os.path.join(MODEL_DIR, req.job_id, "global_model.pt")
    checksum, size_bytes = save_model_to_disk(state_dict, save_path)

    round_controller.cleanup(req.job_id)
    weight_store.clear_job(req.job_id)

    return FinalizeResponse(
        model_path=save_path,
        checksum=checksum,
        size_bytes=size_bytes,
    )


# ── GET /fl/status/{job_id} ───────────────────────────────────────────────────

@router.get("/status/{job_id}", response_model=StatusResponse)
def get_status(job_id: str):
    """Returns round state and trust scores for a job."""
    if not round_controller.job_exists(job_id):
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    current_round = round_controller.get_round(job_id)
    submitted     = weight_store.count(job_id, current_round)

    return StatusResponse(
        job_id=job_id,
        round=current_round,
        status="active",
        participants_submitted=submitted,
        participants_expected=0,
        aggregation_mode=AGGREGATION_MODE,   # NEW
    )


# ── GET /fl/trust-scores ──────────────────────────────────────────────────────

@router.get("/trust-scores")
def trust_scores():
    """
    Returns the current trust registry for all companies.
    Useful for the Node.js admin dashboard to show who has high/low trust.
    """
    return {"trust_scores": get_trust_scores(), "mode": AGGREGATION_MODE}