import fastapi
import  aiohttp
from torch.utils.data import DataLoader
from sklearn.model_selection import train_test_split
import torch.nn as nn
import torch.nn.functional as F
localTraining = fastapi.FastAPI()


class Model(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 20, 5)

    def forward(self, x):
        return F.relu(self.conv1(x))


X = []
y = []

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

@localTraining.post("/train")
async def train():
    model = Model()
    train_loader = DataLoader(list(zip(X_train, y_train)), batch_size=32, shuffle=True)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    criterion = nn.CrossEntropyLoss()

    for epoch in range(10):
        for batch_X, batch_y in train_loader:
            optimizer.zero_grad()
            outputs = model(batch_X)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
    weights = model.state_dict()
    async with aiohttp.ClientSession() as session:
        async with session.post("http://localhost:8000/Server/send_weights", json={"weights": weights}) as response:
            return await response.json()


@localTraining.get("/get_weights")
async def get_weights():
    async with aiohttp.ClientSession() as session:
        async with session.get("http://localhost:8000/Server/get_weights") as response:
            data = await response.json()
            return nn.Module.load_state_dict(data["weights"])




