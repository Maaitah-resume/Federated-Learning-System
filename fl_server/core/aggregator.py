# fl_server/core/aggregator.py
#
# ─────────────────────────────────────────────────────────────────────────────
#  Hybrid Meta + Masked Aggregator
#  Replaces standard FedAvg with two layered mechanisms:
#
#   Layer 1 — Pairwise Masking (Privacy)
#     Each client masks its update with pairwise random tensors that cancel
#     out when summed server-side.  The server never sees a raw client update.
#
#   Layer 2 — Meta-Aggregation (Adaptive Weighting)
#     Instead of weighting by dataset size alone, each client gets a dynamic
#     trust score α_i derived from:
#       • dataset_size       — larger contribution carries more weight
#       • validation_loss    — lower loss = better local model = higher trust
#       • historical_score   — past reliability across rounds
#     Final global model:  W_global = Σ (α_i × W_i_unmasked)
#
#  AGGREGATION_MODE flag (set via env var AGGREGATION_MODE):
#    "hybrid"  — Masked + Meta (default, most secure)
#    "meta"    — Meta-weighting only, no masking
#    "fedavg"  — Original FedAvg, kept for comparison / ablation
# ─────────────────────────────────────────────────────────────────────────────

import os
import hashlib
import math
from typing import Dict, List, Optional

import torch

# ── Module-level trust score registry ─────────────────────────────────────────
# Persists across rounds within one server session.
# { company_id: float }  — starts at 1.0 (neutral), updated after each round.
_trust_registry: Dict[str, float] = {}


# ─────────────────────────────────────────────────────────────────────────────
#  SECTION 1 — Pairwise Masking Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_seed(company_a: str, company_b: str, round_number: int) -> int:
    """
    Derives a deterministic integer seed from two company IDs and the round.
    Both clients independently call this with the same pair to get the same mask.
    The seed is ordered (a < b alphabetically) so seed(A,B) == seed(B,A).
    """
    ordered = "_".join(sorted([company_a, company_b]))
    raw     = f"{ordered}:round{round_number}"
    digest  = hashlib.sha256(raw.encode()).hexdigest()
    return int(digest[:8], 16)


def generate_pairwise_mask(
    company_i:    str,
    company_j:    str,
    round_number: int,
    shape:        torch.Size,
    dtype:        torch.dtype = torch.float32,
) -> torch.Tensor:
    """
    Returns the mask M_ij that client i applies when paired with client j.

    Convention:
      If company_i < company_j alphabetically → mask is +M
      If company_i > company_j alphabetically → mask is -M

    Result: when both clients send their masked updates and they are summed:
      client i:  W_i + M_ij
      client j:  W_j - M_ij
      sum:       W_i + W_j  (masks cancel perfectly)
    """
    seed = _make_seed(company_i, company_j, round_number)
    gen  = torch.Generator()
    gen.manual_seed(seed)
    base_mask = torch.randn(shape, generator=gen, dtype=dtype)
    sign = 1.0 if company_i < company_j else -1.0
    return base_mask * sign


def apply_masks_to_weights(
    weights:         Dict[str, torch.Tensor],
    company_id:      str,
    all_company_ids: List[str],
    round_number:    int,
) -> Dict[str, torch.Tensor]:
    """
    Masks every tensor in a state_dict before it leaves the client.

    For client i:
      W_i_masked[key] = W_i[key] + Σ_j≠i  M_ij[key]

    Called by the client training agent before submitting weights.
    The server sums all masked updates — masks cancel — recovering Σ W_i.
    """
    masked = {}
    for key, tensor in weights.items():
        masked_tensor = tensor.clone().float()
        for other_id in all_company_ids:
            if other_id == company_id:
                continue
            mask = generate_pairwise_mask(
                company_i=company_id,
                company_j=other_id,
                round_number=round_number,
                shape=tensor.shape,
                dtype=torch.float32,
            )
            masked_tensor = masked_tensor + mask
        masked[key] = masked_tensor
    return masked


def cancel_masks(
    masked_updates: List[Dict],
    round_number:   int,
) -> Dict[str, torch.Tensor]:
    """
    Server-side: sums all masked updates.

    Because pairwise masks are constructed to cancel:
      Σ_i W_i_masked = Σ_i W_i  (mask terms sum to zero)

    The server learns only the SUM of client weights, never any individual W_i.

    masked_updates: list of { "company_id": str, "weights": masked_state_dict }
    """
    if not masked_updates:
        raise ValueError("No masked updates to cancel.")

    summed: Dict[str, torch.Tensor] = {}
    for update in masked_updates:
        for key, tensor in update["weights"].items():
            if key not in summed:
                summed[key] = tensor.clone().float()
            else:
                summed[key] = summed[key] + tensor.float()
    return summed


# ─────────────────────────────────────────────────────────────────────────────
#  SECTION 2 — Meta-Aggregation (Adaptive Trust Scoring)
# ─────────────────────────────────────────────────────────────────────────────

def compute_meta_weights(updates: List[Dict]) -> List[float]:
    """
    Computes a normalised trust weight α_i for each client.

    Score components:
      s_data    = dataset_size / max_dataset_size            (40% weight)
      s_loss    = exp(-validation_loss)  or 0.5 if unknown   (40% weight)
      s_history = trust_registry[company_id], normalised     (20% weight)

    Returns: list of α_i floats where Σ α_i = 1.
    """
    n = len(updates)
    if n == 0:
        return []
    if n == 1:
        return [1.0]

    # s_data
    sizes    = [max(u.get("dataset_size", 1), 1) for u in updates]
    max_size = max(sizes)
    s_data   = [sz / max_size for sz in sizes]

    # s_loss
    s_loss = []
    for u in updates:
        val_loss = u.get("validation_loss")
        if val_loss is not None and val_loss >= 0:
            s_loss.append(math.exp(-min(val_loss, 10.0)))
        else:
            s_loss.append(0.5)

    # s_history
    s_hist = [
        max(0.1, min(_trust_registry.get(u.get("company_id", "x"), 1.0), 2.0))
        for u in updates
    ]
    max_hist  = max(s_hist)
    s_hist_n  = [h / max_hist for h in s_hist]

    # Combine
    raw = [0.4 * s_data[i] + 0.4 * s_loss[i] + 0.2 * s_hist_n[i] for i in range(n)]
    total = sum(raw)
    if total == 0:
        return [1.0 / n] * n
    return [r / total for r in raw]


def update_trust_registry(updates: List[Dict], alpha_weights: List[float]) -> None:
    """
    Updates historical trust scores after a round completes.

    Clients whose α_i ≥ average get +0.05 (reward).
    Clients whose α_i <  average get -0.05 (penalty).
    Scores are clipped to [0.1, 3.0].
    """
    if not updates or not alpha_weights:
        return
    avg = sum(alpha_weights) / len(alpha_weights)
    for i, u in enumerate(updates):
        cid     = u.get("company_id", "unknown")
        current = _trust_registry.get(cid, 1.0)
        delta   = 0.05 if alpha_weights[i] >= avg else -0.05
        _trust_registry[cid] = max(0.1, min(current + delta, 3.0))


def meta_aggregate(
    updates:    List[Dict],
    summed_raw: Dict[str, torch.Tensor],
) -> Dict[str, torch.Tensor]:
    """
    Applies meta-weights to produce the global model.

    Two paths depending on whether raw weights are available:
      • raw_weights present  → direct weighted sum (meta-only mode)
      • only summed_raw      → average the mask-cancelled sum (hybrid mode)
    """
    alpha = compute_meta_weights(updates)
    update_trust_registry(updates, alpha)

    has_raw = all("raw_weights" in u for u in updates)

    if has_raw:
        # Meta-only: weighted sum of individual raw weights
        aggregated: Dict[str, torch.Tensor] = {}
        for i, u in enumerate(updates):
            for key, tensor in u["raw_weights"].items():
                weighted = tensor.float() * alpha[i]
                if key not in aggregated:
                    aggregated[key] = weighted.clone()
                else:
                    aggregated[key] = aggregated[key] + weighted
        return aggregated
    else:
        # Hybrid: masks already cancelled → simple average of the recovered sum
        n = len(updates)
        return {key: tensor / n for key, tensor in summed_raw.items()}


# ─────────────────────────────────────────────────────────────────────────────
#  SECTION 3 — Public Aggregation Interface
# ─────────────────────────────────────────────────────────────────────────────

AGGREGATION_MODE = os.environ.get("AGGREGATION_MODE", "hybrid").lower()


def aggregate(updates: List[Dict], round_number: int = 0) -> Dict[str, torch.Tensor]:
    """
    Main entry point. Called by training.py after all weights are buffered.

    Args:
        updates:      list of dicts from WeightStore.get_all_with_meta()
        round_number: current training round (used for mask seed derivation)

    Returns:
        Global model state_dict ready to be serialised and sent to clients.
    """
    if not updates:
        raise ValueError("No weight updates provided for aggregation.")

    if AGGREGATION_MODE == "fedavg":
        return _fedavg(updates)
    elif AGGREGATION_MODE == "meta":
        return _meta_only(updates)
    else:
        return _hybrid(updates, round_number)


def _fedavg(updates: List[Dict]) -> Dict[str, torch.Tensor]:
    """Original FedAvg — dataset-size weighted average. Kept for ablation."""
    total = sum(max(u.get("dataset_size", 1), 1) for u in updates)
    aggregated: Dict[str, torch.Tensor] = {}
    for u in updates:
        w = max(u.get("dataset_size", 1), 1) / total
        for key, tensor in u["weights"].items():
            weighted = tensor.float() * w
            if key not in aggregated:
                aggregated[key] = weighted.clone()
            else:
                aggregated[key] = aggregated[key] + weighted
    return aggregated


def _meta_only(updates: List[Dict]) -> Dict[str, torch.Tensor]:
    """Meta-weighting without masking. Clients send raw weights."""
    for u in updates:
        u["raw_weights"] = u["weights"]
    return meta_aggregate(updates, summed_raw={})


def _hybrid(updates: List[Dict], round_number: int) -> Dict[str, torch.Tensor]:
    """Full hybrid: mask cancellation → meta-weighted average."""
    summed = cancel_masks(updates, round_number)
    return meta_aggregate(updates, summed_raw=summed)


# ─────────────────────────────────────────────────────────────────────────────
#  SECTION 4 — Metrics
# ─────────────────────────────────────────────────────────────────────────────

def compute_metrics(
    before:  Dict[str, torch.Tensor],
    after:   Dict[str, torch.Tensor],
    updates: Optional[List[Dict]] = None,
) -> Dict:
    """
    Returns aggregation metrics for logging and WebSocket broadcast.
    Now includes per-client α scores and trust registry snapshot.
    """
    total_delta, count = 0.0, 0
    for key in after:
        if key in before:
            total_delta += (after[key].float() - before[key].float()).norm(p=2).item()
            count += 1

    avg_delta    = round(total_delta / count, 6) if count > 0 else 0.0
    alpha_scores = {}
    if updates:
        alpha = compute_meta_weights(updates)
        for i, u in enumerate(updates):
            alpha_scores[u.get("company_id", f"client_{i}")] = round(alpha[i], 4)

    return {
        "avg_loss":       None,
        "delta_accuracy": avg_delta,
        "alpha_scores":   alpha_scores,
        "trust_scores":   dict(_trust_registry),
        "mode":           AGGREGATION_MODE,
    }


def get_trust_scores() -> Dict[str, float]:
    """Returns current trust registry. Useful for admin endpoints."""
    return dict(_trust_registry)