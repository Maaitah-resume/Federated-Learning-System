# fl_server/api/routes/health.py
import torch
from fastapi import APIRouter
from api.schemas.responses import HealthResponse
from core.aggregator       import AGGREGATION_MODE

router = APIRouter()

@router.get("/health", response_model=HealthResponse)
def health_check():
    return HealthResponse(
        status="ok",
        device="cuda" if torch.cuda.is_available() else "cpu",
        version="2.0.0",
        aggregation_mode=AGGREGATION_MODE,
    )