# fl_server/api/schemas/responses.py
from pydantic import BaseModel
from typing import Optional, Dict


class InitializeResponse(BaseModel):
    weights_b64:        str
    model_architecture: str
    num_params:         int


class DistributeResponse(BaseModel):
    round_model_b64: str
    round_id:        str


class ReceiveWeightsResponse(BaseModel):
    received:    bool
    waiting_for: int


class AggregationMetrics(BaseModel):
    avg_loss:       Optional[float]       = None
    delta_accuracy: Optional[float]       = None
    # NEW: meta-aggregator outputs
    alpha_scores:   Optional[Dict[str, float]] = None  # per-client trust weights
    trust_scores:   Optional[Dict[str, float]] = None  # historical trust registry
    mode:           Optional[str]              = None  # which algorithm was used


class AggregateResponse(BaseModel):
    aggregated_weights_b64: str
    metrics:                AggregationMetrics


class FinalizeResponse(BaseModel):
    model_path:  str
    checksum:    str
    size_bytes:  int


class StatusResponse(BaseModel):
    job_id:                 str
    round:                  int
    status:                 str
    participants_submitted: int
    participants_expected:  int
    aggregation_mode:       str   # NEW: shows current mode


class HealthResponse(BaseModel):
    status:           str
    device:           str
    version:          str
    aggregation_mode: str   # NEW: shows configured mode