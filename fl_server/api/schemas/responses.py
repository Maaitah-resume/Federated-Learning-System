from pydantic import BaseModel, ConfigDict
from typing import Optional, Dict


class InitializeResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())  # fixes model_ warning

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
    avg_loss:       Optional[float]            = None
    delta_accuracy: Optional[float]            = None
    alpha_scores:   Optional[Dict[str, float]] = None
    trust_scores:   Optional[Dict[str, float]] = None
    mode:           Optional[str]              = None


class AggregateResponse(BaseModel):
    aggregated_weights_b64: str
    metrics:                AggregationMetrics


class FinalizeResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())  # fixes model_path warning

    model_path:  str
    checksum:    str
    size_bytes:  int


class StatusResponse(BaseModel):
    job_id:                 str
    round:                  int
    status:                 str
    participants_submitted: int
    participants_expected:  int
    aggregation_mode:       str


class HealthResponse(BaseModel):
    status:           str
    device:           str
    version:          str
    aggregation_mode: str
