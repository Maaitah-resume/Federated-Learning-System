# fl_server/api/schemas/requests.py
from pydantic import BaseModel, Field
from typing import List, Optional


class InitializeRequest(BaseModel):
    job_id:        str = Field(..., description="Unique training job identifier")
    model_version: str = Field("IDSNet_v2", description="Model architecture tag")


class DistributeRequest(BaseModel):
    job_id:          str       = Field(...)
    round:           int       = Field(..., ge=1)
    participant_ids: List[str] = Field(..., description="companyIds for this round")


class ReceiveWeightsRequest(BaseModel):
    job_id:          str            = Field(...)
    round:           int            = Field(..., ge=1)
    company_id:      str            = Field(...)
    weights_b64:     str            = Field(..., description="base64-encoded state_dict (may be masked)")
    dataset_size:    int            = Field(0, ge=0)
    # NEW: optional fields for meta-aggregation
    validation_loss: Optional[float] = Field(None, description="Local validation loss after training")
    is_masked:       bool            = Field(True,  description="True if pairwise masks were applied")


class AggregateRequest(BaseModel):
    job_id:       str            = Field(...)
    round:        int            = Field(..., ge=1)
    # NEW: override mode per-round (optional — server default used if omitted)
    mode_override: Optional[str] = Field(None, description="fedavg | meta | hybrid")


class FinalizeRequest(BaseModel):
    job_id: str = Field(...)