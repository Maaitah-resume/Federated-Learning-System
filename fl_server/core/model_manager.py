# fl_server/core/model_manager.py
import base64
import hashlib
import io
import os
from typing import Dict, Any

import torch

from models.ids_model import build_model, IDSNet


def serialize_weights(state_dict: Dict[str, torch.Tensor]) -> str:
    """Converts a PyTorch state_dict to a base64 string for JSON transport."""
    buffer = io.BytesIO()
    torch.save(state_dict, buffer)
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode("utf-8")


def deserialize_weights(weights_b64: str) -> Dict[str, torch.Tensor]:
    """Converts a base64 string back to a PyTorch state_dict."""
    raw    = base64.b64decode(weights_b64.encode("utf-8"))
    buffer = io.BytesIO(raw)
    return torch.load(buffer, map_location="cpu", weights_only=True)


def build_fresh_model() -> IDSNet:
    """Returns a model with randomly initialised weights."""
    return build_model()


def count_parameters(model: IDSNet) -> int:
    return sum(p.numel() for p in model.parameters())


def save_model_to_disk(state_dict: Dict[str, torch.Tensor], path: str) -> tuple[str, int]:
    """
    Saves a state_dict to disk as a .pt file.
    Returns (sha256_checksum, file_size_bytes).
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    torch.save(state_dict, path)

    with open(path, "rb") as f:
        data = f.read()

    checksum   = hashlib.sha256(data).hexdigest()
    size_bytes = len(data)
    return checksum, size_bytes


def load_model_from_disk(path: str) -> IDSNet:
    """Loads a saved .pt file back into an IDSNet model."""
    model      = build_model()
    state_dict = torch.load(path, map_location="cpu", weights_only=True)
    model.load_state_dict(state_dict)
    return model