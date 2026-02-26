import fastapi
import aiohttp

app = fastapi.FastAPI()
CORS_ORGINS = ["*"]

client_weights = []
global_weights = []

@app.post("/send_weights")
async def send_weights(weights: list):
    async with aiohttp.ClientSession() as session:
        async with session.post("http://localhost:8000/Client/send_weights", json={"weights": weights}) as response:
            return await response.json()





@app.get("/get_weights")
async def get_weights():
    async with aiohttp.ClientSession() as session:
        async with session.get("http://localhost:8000/Client/get_weights") as response:
            data = await response.json()
            return data
        



        





        



