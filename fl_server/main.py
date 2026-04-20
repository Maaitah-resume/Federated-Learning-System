# fl_server/main.py
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes.training import router as training_router
from api.routes.health   import router as health_router

app = FastAPI(
    title="FL-IDS Python FL Server",
    description="Federated Learning microservice — handles model init, weight aggregation, and export.",
    version="1.0.0",
    # Only Node.js backend should call this service.
    # Disable the public docs in production if needed.
    docs_url="/docs",
    redoc_url=None,
)

# CORS — only the Node backend needs access (internal Docker network)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to node-backend hostname in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(training_router)
app.include_router(health_router)


# ── Startup log ───────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    import torch
    device    = "cuda" if torch.cuda.is_available() else "cpu"
    model_dir = os.environ.get("MODEL_STORE_PATH", "./models")
    os.makedirs(model_dir, exist_ok=True)

    print("=" * 50)
    print(" FL-IDS Python FL Server — started")
    print(f" Device:      {device}")
    print(f" Model store: {model_dir}")
    print(f" Docs:        http://localhost:8000/docs")
    print("=" * 50)