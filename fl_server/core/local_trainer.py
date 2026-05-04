# fl_server/core/local_trainer.py
import io
import base64
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from typing import Dict

from models.ids_model import IDSNet
from core.data_engineer import preprocess_with_schema


def train_local(
    global_weights_b64: str,
    csv_bytes:          bytes,
    schema:             Dict,
    epochs:             int = 3,
    batch_size:         int = 32,
    lr:                 float = 0.001,
) -> Dict:
    """
    Trains the model on local data using a shared schema.
    Model dims come from the schema, not hardcoded.
    """
    input_dim  = schema['input_dim']
    output_dim = schema['output_dim']
    is_binary  = schema['is_binary']

    # Load global weights into a freshly-sized model
    raw        = base64.b64decode(global_weights_b64.encode())
    state_dict = torch.load(io.BytesIO(raw), map_location='cpu', weights_only=True)

    model = IDSNet(input_dim=input_dim, output_dim=output_dim)
    model.load_state_dict(state_dict)
    model.train()

    # Preprocess using shared schema
    X, y = preprocess_with_schema(csv_bytes, schema)

    if is_binary:
        y_target = y.unsqueeze(1)
        criterion = nn.BCEWithLogitsLoss()
    else:
        y_target = y.long()
        criterion = nn.CrossEntropyLoss()

    dataset    = TensorDataset(X, y_target)
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    optimizer  = torch.optim.Adam(model.parameters(), lr=lr)

    total_loss, steps = 0.0, 0
    for _ in range(epochs):
        for X_b, y_b in dataloader:
            optimizer.zero_grad()
            out  = model(X_b)
            loss = criterion(out, y_b)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            steps += 1

    # Evaluate
    model.eval()
    with torch.no_grad():
        logits = model(X)
        if is_binary:
            preds = (torch.sigmoid(logits) >= 0.5).float().squeeze().numpy()
        else:
            preds = torch.argmax(logits, dim=1).numpy()
        labels = y.numpy()

    acc       = float(accuracy_score(labels, preds))
    f1        = float(f1_score(labels, preds, zero_division=0, average='binary' if is_binary else 'macro'))
    precision = float(precision_score(labels, preds, zero_division=0, average='binary' if is_binary else 'macro'))
    recall    = float(recall_score(labels, preds, zero_division=0, average='binary' if is_binary else 'macro'))
    avg_loss  = total_loss / max(steps, 1)

    out_buf = io.BytesIO()
    torch.save(model.state_dict(), out_buf)
    weights_b64 = base64.b64encode(out_buf.getvalue()).decode('utf-8')

    return {
        'weights_b64':  weights_b64,
        'dataset_size': len(X),
        'metrics': {
            'accuracy':         round(acc,       4),
            'loss':             round(avg_loss,  4),
            'f1_score':         round(f1,        4),
            'precision':        round(precision, 4),
            'recall':           round(recall,    4),
            'validation_loss':  round(avg_loss,  4),
        },
    }
