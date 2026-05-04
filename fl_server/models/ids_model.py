import torch
import torch.nn as nn


class IDSNet(nn.Module):
    """
    Dynamic IDS network — input/output dims are determined at instantiation
    from the dataset schema, NOT hardcoded.
    """

    def __init__(self, input_dim: int = 25, output_dim: int = 1, hidden_dim: int = 128):
        super().__init__()
        self.input_dim  = input_dim
        self.output_dim = output_dim

        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.3),

            nn.Linear(hidden_dim, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(0.2),

            nn.Linear(64, 32),
            nn.ReLU(),

            nn.Linear(32, output_dim),
        )

    def forward(self, x):
        return self.net(x)


def build_model(input_dim: int = 25, output_dim: int = 1) -> IDSNet:
    model = IDSNet(input_dim=input_dim, output_dim=output_dim)
    model.eval()
    return model
