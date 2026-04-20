# FL-IDS Deployment Guide

## How Node.js and Python communicate

```
Company Browser
      │
      │  HTTPS (port 4000)
      ▼
Node.js Backend  ──── HTTP REST (internal) ────►  Python FL Server
      │                  port 8000                      │
      │                                                 │
      ▼                                            PyTorch + FedAvg
   MongoDB                                              │
                                                   /models volume
                                                  global_model.pt
```

Node.js is the **only** caller of the Python service.
Companies never contact Python directly.
Python is invisible to the outside world.

---

## Project folder layout

```
fl-ids/                        ← project root
├── backend/                   ← Node.js
├── fl_server/                 ← Python FastAPI
├── frontend/                  ← React (Vite)
└── docker-compose.yml
```

---

## Option A — Run locally (development)

### Prerequisites
- Node.js 20+
- Python 3.11+
- MongoDB running locally
- Git

### Step 1 — Clone and set up

```bash
git clone https://github.com/Maaitah-resume/fl-ids.git
cd fl-ids
```

### Step 2 — Start MongoDB

```bash
# If you have Docker:
docker run -d -p 27017:27017 --name mongo mongo:7

# Or install MongoDB locally from mongodb.com
```

### Step 3 — Start the Python FL server

```bash
cd fl_server
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Confirm it works: open http://localhost:8000/docs

### Step 4 — Start the Node.js backend

```bash
cd backend
cp .env.example .env            # edit MONGODB_URI if needed
npm install
npm run seed                    # creates demo companies
npm run dev
```

Confirm it works: open http://localhost:4000/health

### Step 5 — Start the React frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### Demo login credentials
| Company | Token |
|---------|-------|
| alpha   | demo-token-alpha |
| beta    | demo-token-beta  |
| gamma   | demo-token-gamma |

---

## Option B — Docker Compose (recommended for demo/production)

### Prerequisites
- Docker Desktop installed
- docker-compose installed

### Step 1 — Build and start all four containers

```bash
cd fl-ids          # project root (where docker-compose.yml lives)
docker-compose up --build
```

This starts:
- React frontend       → http://localhost:3000
- Node.js backend      → http://localhost:4000
- Python FL server     → internal only (port 8000, not exposed)
- MongoDB              → internal only

### Step 2 — Seed demo companies

```bash
docker-compose exec node-backend npm run seed
```

### Step 3 — Open the app

http://localhost:3000

Log in with any company name (auto-created in demo mode).

### Stop everything

```bash
docker-compose down
```

### Stop and delete all data

```bash
docker-compose down -v    # -v removes MongoDB volume
```

---

## Option C — Deploy to a live server (VPS / cloud)

### Prerequisites
- A VPS (DigitalOcean, Hetzner, AWS EC2, etc.) with Ubuntu 22.04
- A domain name (optional but recommended)
- Docker + docker-compose installed on the server

### Step 1 — SSH into your server

```bash
ssh root@your-server-ip
```

### Step 2 — Install Docker

```bash
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin
```

### Step 3 — Clone your repo

```bash
git clone https://github.com/Maaitah-resume/fl-ids.git
cd fl-ids
```

### Step 4 — Set production environment

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Change these values:
```env
NODE_ENV=production
JWT_SECRET=generate-a-random-64-char-string-here
MONGODB_URI=mongodb://mongodb:27017/fl_ids
PYTHON_FL_URL=http://python-fl-server:8000
```

### Step 5 — Start

```bash
docker-compose up -d --build
```

`-d` runs in the background.

### Step 6 — Seed companies

```bash
docker-compose exec node-backend npm run seed
```

### Step 7 — Check everything is running

```bash
docker-compose ps
curl http://localhost:4000/health
```

### Step 8 — Open firewall ports

```bash
ufw allow 3000    # frontend
ufw allow 4000    # backend API
ufw enable
```

Your app is now live at:
- http://your-server-ip:3000   (frontend)
- http://your-server-ip:4000   (API)

---

## Useful commands

```bash
# View live logs
docker-compose logs -f node-backend
docker-compose logs -f python-fl-server

# Restart one container
docker-compose restart node-backend

# Run backend tests
docker-compose exec node-backend npm test

# Open MongoDB shell
docker-compose exec mongodb mongosh fl_ids

# Rebuild after code changes
docker-compose up --build -d
```

---

## How a training round flows end-to-end

```
1. Company A, B, C log in via browser → Node issues demo tokens

2. Each company clicks "Join Queue"
   Browser → POST /api/queue/join → Node
   Node → queue count reaches MIN_CLIENTS (3)
   Node → auto-starts training job

3. Node → POST /fl/initialize → Python
   Python creates IDSNet model, returns base64 weights

4. Node → WebSocket broadcast "round:started" → all browsers

5. Each company → GET /api/training/model → Node
   Node → POST /fl/distribute → Python → returns weights
   Company receives global model weights

6. Company trains locally on their private data (Python script on their machine)
   Company → POST /api/training/submit-weights → Node
   Node → POST /fl/receive-weights → Python (buffers in weight_store)

7. All 3 companies submitted:
   Node → POST /fl/aggregate → Python
   Python runs FedAvg, returns new global weights
   Node updates round record in MongoDB

8. Repeat steps 4-7 for each round (default: 5 rounds)

9. Final round done:
   Node → POST /fl/finalize → Python
   Python saves global_model.pt to shared volume
   Node → WebSocket broadcast "training:complete"

10. Each company → GET /api/models/:id/download
    Node streams global_model.pt from shared volume
```
