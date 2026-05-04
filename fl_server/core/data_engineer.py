# fl_server/core/data_engineer.py
import io
import pandas as pd
import numpy as np
import torch
from typing import Dict, Tuple, List


def analyze_csv(csv_bytes: bytes) -> Dict:
    """
    Analyzes a CSV and returns a complete schema describing how to process it.
    Auto-detects:
      - target column (last column, or column named 'label'/'target'/'class')
      - numerical vs categorical columns
      - unique values for categorical columns (for encoding)
      - whether target is binary or multi-class
    """
    df = pd.read_csv(io.BytesIO(csv_bytes))

    # 1. Identify target column (smart detection)
    target_candidates = ['label', 'target', 'class', 'attack_type', 'y']
    target_col = None
    for cand in target_candidates:
        for col in df.columns:
            if col.lower() == cand:
                target_col = col
                break
        if target_col:
            break
    # Fallback: assume last column is target
    if target_col is None:
        target_col = df.columns[-1]

    feature_cols = [c for c in df.columns if c != target_col]

    # 2. Classify each column as numerical or categorical
    numerical_cols   = []
    categorical_cols = []
    categorical_maps = {}

    for col in feature_cols:
        if pd.api.types.is_numeric_dtype(df[col]):
            numerical_cols.append(col)
        else:
            categorical_cols.append(col)
            unique_vals = sorted(df[col].dropna().astype(str).unique().tolist())
            categorical_maps[col] = {v: i for i, v in enumerate(unique_vals)}

    # 3. Analyze target
    target_unique = sorted(df[target_col].dropna().astype(str).unique().tolist())
    is_binary     = len(target_unique) == 2
    target_map    = {v: i for i, v in enumerate(target_unique)}

    # If target has values like 'normal' vs others, treat as binary attack/normal
    normal_keywords = ['normal', 'benign', 'clean', '0', 'false', 'no']
    has_normal = any(str(v).lower() in normal_keywords for v in target_unique)

    if has_normal and len(target_unique) > 2:
        is_binary = True  # multi-class but we'll binarize: normal=0, anything else=1
        target_map = {v: (0 if str(v).lower() in normal_keywords else 1) for v in target_unique}

    input_dim = len(numerical_cols) + len(categorical_cols)

    # Compute normalization stats from this dataset (shared across participants)
    feature_stats = {}
    for col in numerical_cols:
        feature_stats[col] = {
            'min': float(df[col].min()),
            'max': float(df[col].max()),
            'mean': float(df[col].mean()),
            'std':  float(df[col].std()) if df[col].std() > 0 else 1.0,
        }

    return {
        'target_col':        target_col,
        'numerical_cols':    numerical_cols,
        'categorical_cols':  categorical_cols,
        'categorical_maps':  categorical_maps,
        'target_map':        target_map,
        'target_unique':     target_unique,
        'is_binary':         is_binary,
        'input_dim':         input_dim,
        'output_dim':        1 if is_binary else len(target_unique),
        'feature_stats':     feature_stats,
        'sample_count':      len(df),
    }


def preprocess_with_schema(csv_bytes: bytes, schema: Dict) -> Tuple[torch.Tensor, torch.Tensor]:
    """
    Applies a saved schema to preprocess any matching CSV.
    All participants use the SAME schema → consistent feature space.
    """
    df = pd.read_csv(io.BytesIO(csv_bytes))

    # Encode categoricals using the schema's maps (unknown values → 0)
    for col, mapping in schema['categorical_maps'].items():
        if col in df.columns:
            df[col] = df[col].astype(str).map(mapping).fillna(0).astype(int)

    # Encode target
    target_col = schema['target_col']
    if target_col in df.columns:
        df[target_col] = df[target_col].astype(str).map(schema['target_map']).fillna(0).astype(int)

    # Build feature matrix in fixed column order
    feature_cols = schema['numerical_cols'] + schema['categorical_cols']
    X = df[feature_cols].fillna(0).values.astype(np.float32)
    y = df[target_col].values.astype(np.float32)

    # Normalize numerical features using schema stats (z-score)
    for i, col in enumerate(schema['numerical_cols']):
        stats = schema['feature_stats'].get(col, {'mean': 0, 'std': 1})
        X[:, i] = (X[:, i] - stats['mean']) / (stats['std'] if stats['std'] > 0 else 1)

    return torch.tensor(X), torch.tensor(y)
