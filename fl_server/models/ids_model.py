# fl_server/models/ids_model.py
# Intrusion Detection System neural network.
# Input: network traffic features (41 KDD Cup features)
# Output: binary classification — normal (0) or attack (1)

import torch
import torch.nn as nn


class IDSNet(nn.Module):
    """
    Fully-connected feed-forward network for network intrusion detection.
    Architecture is deliberately simple so local training on a single company's
    dataset completes in seconds even on CPU.
    """

    INPUT_DIM  = 41   # KDD Cup 99 / NSL-KDD feature count
    HIDDEN_DIM = 128
    OUTPUT_DIM = 1    # sigmoid → probability of attack

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(self.INPUT_DIM, self.HIDDEN_DIM),
            nn.BatchNorm1d(self.HIDDEN_DIM),
            nn.ReLU(),
            nn.Dropout(0.3),

            nn.Linear(self.HIDDEN_DIM, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(0.2),

            nn.Linear(64, 32),
            nn.ReLU(),

            nn.Linear(32, self.OUTPUT_DIM),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)

    def predict(self, x: torch.Tensor, threshold: float = 0.5) -> torch.Tensor:
        """Returns binary predictions (0 = normal, 1 = attack)."""
        with torch.no_grad():
            logits = self.forward(x)
            probs  = torch.sigmoid(logits)
            return (probs >= threshold).float()


def build_model() -> IDSNet:
    """Factory — returns a freshly initialised model on CPU."""
    model = IDSNet()
    model.eval()
    return model