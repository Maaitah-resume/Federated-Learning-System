from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional


class InitializeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())  # fixes model_version warning

    job_id:          str = Field(..., description="Unique training job identifier")
    model_version:   str = Field("IDSNet_v2", description="Model architecture tag")
    sample_csv_b64:  Optional[str] = Field(None, description="Optional CSV for schema detection")


class DistributeRequest(BaseModel):
    job_id:          str       = Field(...)
    round:           int       = Field(..., ge=1)
    participant_ids: List[str] = Field(..., description="companyIds for this round")


class ReceiveWeightsRequest(BaseModel):
    job_id:          str             = Field(...)
    round:           int             = Field(..., ge=1)
    company_id:      str             = Field(...)
    weights_b64:     str             = Field(...)
    dataset_size:    int             = Field(0, ge=0)
    validation_loss: Optional[float] = Field(None)
    is_masked:       bool            = Field(True)


class AggregateRequest(BaseModel):
    job_id:        str            = Field(...)
    round:         int            = Field(..., ge=1)
    mode_override: Optional[str] = Field(None)


class FinalizeRequest(BaseModel):
    job_id: str = Field(...)
