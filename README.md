# FL-IDS Web Platform — Production Architecture Design

**Federated Learning Intrusion Detection System**
**Document Type:** System Architecture & Design Specification
**Version:** 2.0 — Browser-Native Federated Learning
**Reference Paper:** Chen et al. (2020) — *Privacy-Preserving IDS Using Federated Learning*
**Deployment:** Railway (live) · MongoDB Atlas · React 19 + TF.js + Node.js/Express

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [What Changed From v1](#2-what-changed-from-v1)
3. [Federated Training Workflow](#3-federated-training-workflow)
4. [Privacy Protocol — Pairwise Masking (Section 3.3)](#4-privacy-protocol--pairwise-masking-section-33)
5. [Quality Protocol — Adaptive Meta-Aggregator (Section 3.4)](#5-quality-protocol--adaptive-meta-aggregator-section-34)
6. [Backend Architecture (Node.js)](#6-backend-architecture-nodejs)
7. [Frontend Architecture (React + TF.js)](#7-frontend-architecture-react--tfjs)
8. [MongoDB Schema](#8-mongodb-schema)
9. [API Endpoints](#9-api-endpoints)
10. [WebSocket Event Catalog](#10-websocket-event-catalog)
11. [IDS Neural Network Architecture](#11-ids-neural-network-architecture)
12. [Model Export Pipeline](#12-model-export-pipeline)
13. [Training Queue Logic](#13-training-queue-logic)
14. [Admin Control System](#14-admin-control-system)
15. [Deployment Architecture (Railway)](#15-deployment-architecture-railway)
16. [Security Model](#16-security-model)

---

## 1. High-Level Architecture

### 1.1 System Overview

The FL-IDS v2 platform is a **two-tier** system. The Python FL server present in v1 has been completely eliminated. All machine learning (model construction, local training, weight extraction, masking) now runs **inside each participant's browser** via TensorFlow.js. The Node.js backend acts purely as a coordination layer — it never touches raw weights or trains any model itself.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         PARTICIPANT BROWSER                                  │
│                  React 19 SPA · TypeScript · Tailwind CSS 4                 │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                       Web Worker (trainingWorker.ts)                    │ │
│  │                                                                         │ │
│  │   ┌──────────────────┐   ┌───────────────────┐   ┌──────────────────┐  │ │
│  │   │  LocalTrainer.ts │   │  Pairwise Masking  │   │  TF.js WebGL     │  │ │
│  │   │  - loadCSV()     │   │  (Section 3.3)     │   │  Backend         │  │ │
│  │   │  - buildModel()  │   │  - mulberry32 PRNG │   │  (GPU training)  │  │ │
│  │   │  - train()       │   │  - mask ±PRG(seed) │   │                  │  │ │
│  │   │  - applyWeights()│   │  - α pre-scaling   │   └──────────────────┘  │ │
│  │   └──────────────────┘   └───────────────────┘                          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Pages: Login │ Dashboard │ Queue (training) │ Models │ AdminDashboard       │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │  HTTPS · WSS
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                  NODE.JS API SERVER  (Railway · Express + Socket.IO)         │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐ │
│  │  authService.js  │  │  queueService.js │  │  federatedOrchestrator.js  │ │
│  │  JWT · bcryptjs  │  │  join/leave/     │  │  AdaptiveMetaAggregator    │ │
│  │  role-based auth │  │  threshold check │  │  Pairwise mask assignment  │ │
│  └──────────────────┘  └──────────────────┘  │  Weight unmasking & sum    │ │
│                                              │  REINFORCE online learning  │ │
│  ┌──────────────────┐  ┌──────────────────┐  └────────────────────────────┘ │
│  │  socketHandler   │  │  SystemConfig    │                                 │
│  │  Socket.IO rooms │  │  Admin-controlled│  ┌────────────────────────────┐ │
│  │  event broadcast │  │  runtime config  │  │  model_converter.py        │ │
│  └──────────────────┘  └──────────────────┘  │  TF.js JSON → Python .pkl  │ │
│                                              └────────────────────────────┘ │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │  Mongoose ODM
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          MONGODB ATLAS (Cloud)                               │
│                                                                              │
│   companies · trainingjobs · participants · trainingmetrics                  │
│   trainingrounds · models · systemconfigs                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Deployed URLs

| Service  | URL |
|----------|-----|
| Frontend | `https://front-end-production-8cbe.up.railway.app` |
| Backend  | `https://earnest-heart-production.up.railway.app` |
| Database | MongoDB Atlas (cloud-managed, no direct public access) |

### 1.3 Component Responsibilities

**Participant Browser (TF.js)**
Each company's browser is the sole ML compute node. It loads a CSV of network traffic data, builds the IDS model entirely in-browser using TF.js, trains for a configurable number of epochs, extracts the weight tensors, applies adaptive pre-scaling, applies the pairwise privacy mask, and POSTs only the masked result. Raw data never leaves the device. No Python runtime is required on participant machines.

**Node.js API Server**
The coordination hub. It manages authentication, the training queue, mask seed assignment, masked weight collection, server-side weight summation (masks cancel algebraically, yielding the quality-weighted global model), model persistence in MongoDB, and real-time event broadcast via Socket.IO. It runs the `AdaptiveMetaAggregator` neural network on the server to compute per-client quality weights (α) for the next round.

**MongoDB Atlas**
Stores all persistent state: company identities, training job lifecycle, per-round metrics, participant status, finalized model weights (as base64), and admin-controlled system configuration. It is the single source of truth.

**model_converter.py**
A Python script invoked on-demand at download time (via Node's `execSync`). It converts the TF.js weight format (`{ shapes, values }` JSON) to a Python NumPy pickle (`.pkl`), so participants can load the model directly with `pickle.load()` in any Python ML stack without writing a custom deserializer.

---

## 2. What Changed From v1

This section captures every architectural change from the original design document.

| Area | v1 (Old) | v2 (Current) |
|------|----------|--------------|
| **ML compute** | Python FL server (FastAPI + PyTorch) | Browser TF.js (Web Worker) |
| **Aggregation** | FedAvg (weighted by dataset size) | Pairwise-Masked + Adaptive Meta-Aggregator (Chen 2020) |
| **Privacy** | None — server received raw weight deltas | Pairwise masking: server only ever sees masked sums |
| **Python service** | Required (Port 8000, Docker container) | Eliminated entirely |
| **Client agent** | Python script on company infrastructure | Browser page only (no installs) |
| **Weight storage** | Encrypted filesystem volume (Docker) | Base64 in MongoDB Atlas (deleted post-use) |
| **Model format** | `.pt` (PyTorch) | `.pkl` (NumPy pickle, converted on download) |
| **Admin config** | Hardcoded env vars | Live DB-backed SystemConfig (writable via admin UI) |
| **Dead services removed** | `orchestratorService`, `jobManager`, `modelRegistry`, `pythonBridge`, `simulatedOrchestrator` | All removed |
| **Dead routes removed** | `training.routes.js`, `data.routes.js`, `model-export.routes.js` | All removed |
| **Queue trigger** | Polling every 10s | Event-driven via Socket.IO rooms + DB poll |
| **Deployment** | Docker Compose (4 containers) | Railway (2 services: frontend + backend) |
| **DB hosting** | Self-hosted MongoDB container | MongoDB Atlas (cloud) |

---

## 3. Federated Training Workflow

### 3.1 Step-by-Step Protocol

```
STEP 1 — Authentication
───────────────────────────────────────────────────────────────────────
  Browser ──POST /api/auth/login {email, password}──► Node Auth
  Node ──bcrypt.compare──► MongoDB (companies collection)
  Node ──JWT {companyId, companyName, role, exp:24h}──► Browser
  Browser stores JWT in localStorage; all subsequent requests: Authorization: Bearer <token>

STEP 2 — Schema Fetch (Round Consistency Guarantee)
───────────────────────────────────────────────────────────────────────
  Browser ──GET /api/federated/schema──► Node
  Node ──returns global ordered label list──► Browser
      e.g. ["BENIGN","DoS Hulk","PortScan","DDoS","FTP-Patator","Bot"]
  Browser uses this schema to build the output layer (6 classes, fixed order)
  CRITICAL: Without this, different participants build models with different
  output layouts that cannot be coherently aggregated.

STEP 3 — Queue Join
───────────────────────────────────────────────────────────────────────
  Browser ──POST /api/queue/join──► Node queueService
  Node ──upsert Participant {status: QUEUED}──► MongoDB
  Node ──Socket.IO broadcast 'queue:state'──► All browsers in room
  Browser Queue page shows live participant list

STEP 4 — CSV Load (Local, Never Uploaded)
───────────────────────────────────────────────────────────────────────
  User drags CICIDS2017-format CSV onto the Queue page drop zone
  Browser Web Worker ──Papa.parse (in-browser)──► Float32 tensors
  No CSV data leaves the browser at any point
  56 feature columns, 1 label column → mapped to schema from Step 2

STEP 5 — Training Auto-Start (Threshold Met)
───────────────────────────────────────────────────────────────────────
  queueService polls MongoDB every 3 seconds
  When queued count >= MIN_CLIENTS (admin-configurable, default: 2):
      Node ──creates TrainingJob {status: INITIALIZING}──► MongoDB
      Node ──updates Participants {status: TRAINING}──► MongoDB
      Node ──federatedOrchestrator.startJob(participantIds)
      Node ──generates pairwise mask seeds for all participant pairs
      Node ──computes α = uniform (1/N) for round 1
      Node ──Socket.IO broadcast 'round:started' {round:1, totalRounds}──► All participants

STEP 6 — Round Start: Adaptive Weights Distribution
───────────────────────────────────────────────────────────────────────
  Each participant browser ──GET /api/federated/weights──► Node
  Node returns:
      { hasWeights: true/false, currentRound, totalRounds,
        weights: globalWeights (null on round 1),
        adaptiveWeights: { companyId_A: α_A, companyId_B: α_B },
        alreadySubmitted: bool }
  If round > 1: browser applies global weights to reset model before training
  α values are used in Step 7 for pre-scaling

STEP 7 — Local Training (In Browser)
───────────────────────────────────────────────────────────────────────
  Web Worker builds IDS model (56 → 128 → 64 → 32 → 6)
  Web Worker trains on local CSV tensors:
      optimizer: Adam(lr=0.001)
      loss: sparseCategoricalCrossentropy
      epochs: 3 (configurable), batchSize: 32, validationSplit: 0.1
  Web Worker extracts weight tensors w_i after training
  Computes update_consistency = 1 − |norm_t − norm_{t-1}| / (norm_{t-1} + ε)
  Sends metrics {accuracy, loss, datasetSize, updateConsistency} to main thread

STEP 8 — Pairwise Masking (Privacy Layer)
───────────────────────────────────────────────────────────────────────
  Browser ──GET /api/federated/masks──► Node
  Node returns:
      { assignments: [{ peerId, seed, role: 'add'|'sub' }] }
      — one assignment per peer this participant is paired with

  Browser applies α pre-scaling: w̃_i = α_i × w_i
  Browser generates masks using mulberry32 PRNG seeded with pair seed:
      For each peer j:
          mask_ij = PRG(s_ij) scaled by MASK_SCALE (0.5)
          if role == 'add':  masked_i += mask_ij  (element-wise)
          if role == 'sub':  masked_i -= mask_ij  (element-wise)
  Result: masked_i = α_i × w_i + Σ_j ±PRG(s_ij)

STEP 9 — Masked Weight Submission
───────────────────────────────────────────────────────────────────────
  Browser ──POST /api/federated/submit──► Node
      Body: { jobId, round, maskedWeights: {shapes, values}, metrics }
  Node stores submission in pendingSubmissions Map (in-memory)
  Node ──saves TrainingMetric {type:'local', round, accuracy, loss}──► MongoDB
  Node broadcasts 'weights:received' {received: N, expected: M}

STEP 10 — Server-Side Aggregation (Masks Cancel)
───────────────────────────────────────────────────────────────────────
  When all N participants have submitted (or timeout reached):
  Node computes:
      globalWeights = Σ_i masked_i
                    = Σ_i (α_i × w_i + Σ_j ±PRG(s_ij))
                    = Σ_i (α_i × w_i) + 0   ← masks cancel
                    = quality-weighted global model
  Node ──saves TrainingMetric {type:'global', round, accuracy, loss}──► MongoDB
  Node ──runs AdaptiveMetaAggregator.update(reward)  ← REINFORCE step
  Node ──computes new α for next round  (or uniform if reward negative)
  Node ──Socket.IO broadcast 'round:complete' {round, metrics}

STEP 11 — Round Loop
───────────────────────────────────────────────────────────────────────
  If currentRound < totalRounds:
      Increment round counter
      Go to STEP 6
  Else:
      Go to STEP 12

STEP 12 — Model Finalization
───────────────────────────────────────────────────────────────────────
  Node ──saves Model document {weightsB64, status:'AVAILABLE'}──► MongoDB
  Node ──Socket.IO broadcast 'training:complete' {jobId, modelId}
  Participants redirected to /models page

STEP 13 — Model Download (On Demand)
───────────────────────────────────────────────────────────────────────
  Browser ──GET /api/models/:modelId/download──► Node
  Node ──verify participant membership──► MongoDB
  Node ──decode weightsB64 → JSON {shapes, values}
  Node ──execSync python3 model_converter.py (temp dir)
  Python ──reconstructs NumPy arrays → pickle.dump()
  Node ──streams .pkl file──► Browser
  Temp files deleted immediately after stream
```

### 3.2 Data Flow Diagram

```
Participant A Browser          Node.js Server           Participant B Browser
        │                           │                           │
        │──GET /api/federated/schema►│◄──GET /api/federated/schema─│
        │◄──["BENIGN","DoS"...]──────│────["BENIGN","DoS"...]──────►│
        │                           │                           │
        │──POST /api/queue/join──────►│◄────POST /api/queue/join────│
        │◄──WS: queue:state──────────│────WS: queue:state──────────►│
        │                           │                           │
        │   [threshold met]          │   [threshold met]         │
        │◄──WS: round:started (r=1)──│───WS: round:started (r=1)──►│
        │                           │                           │
        │──GET /api/federated/weights►│◄──GET /api/federated/weights│
        │◄──{α_A=0.5, no weights}────│────{α_B=0.5, no weights}────►│
        │                           │                           │
        │──GET /api/federated/masks──►│◄────GET /api/federated/masks│
        │◄──{peer:B, seed:X, add}────│────{peer:A, seed:X, sub}────►│
        │                           │                           │
        │  [local CSV training]      │                           │
        │  [apply mask: w̃_A + PRG]  │  [local CSV training]     │
        │                           │  [apply mask: w̃_B - PRG]  │
        │                           │                           │
        │──POST /api/federated/submit►│◄──POST /api/federated/submit│
        │◄──WS: weights:received─────│───WS: weights:received──────►│
        │                           │                           │
        │                           │ [sum: masks cancel]        │
        │                           │ [REINFORCE update α]       │
        │◄──WS: round:complete───────│───WS: round:complete────────►│
        │                           │                           │
        │   [rounds 2…N repeat]      │   [rounds 2…N repeat]     │
        │                           │                           │
        │◄──WS: training:complete────│───WS: training:complete─────►│
        │──GET /api/models/download──►│                           │
        │◄──.pkl file stream─────────│                           │
```

---

## 4. Privacy Protocol — Pairwise Masking (Section 3.3)

### 4.1 Overview

Based on the secure aggregation protocol of Bonawitz et al. (2017), as implemented in Chen et al. Section 3.3. The server receives only masked weight vectors. The masks are constructed from pairwise shared seeds such that they cancel exactly when summed — the server learns only the aggregate, never any individual update.

### 4.2 Seed Assignment (Server Side)

For N participants, the server generates one random integer seed `s_ij` for every unique pair (i, j). Participant i receives `role='add'` for the pair (i,j) and participant j receives `role='sub'` for the same pair, with the same seed.

```javascript
// federatedOrchestrator.js — _generateRoundSeeds()
for (let a = 0; a < ids.length; a++) {
  for (let b = a + 1; b < ids.length; b++) {
    const seed = Math.floor(Math.random() * 2**32);
    roundSeeds.set(`${ids[a]}-${ids[b]}`, seed);
    // ids[a] gets role:'add', ids[b] gets role:'sub'
  }
}
```

### 4.3 Mask Generation (Client Side)

Both client and server use the **identical** Mulberry32 PRNG implementation so masks generated from the same seed are bit-for-bit identical on both sides.

```typescript
// localTrainer.ts — applyPairwiseMask()
for (const { peerId, seed, role } of assignments) {
  const prng = mulberry32(seed);
  for (let t = 0; t < maskedValues.length; t++) {
    for (let v = 0; v < maskedValues[t].length; v++) {
      const noise = (prng() * 2 - 1) * MASK_SCALE;   // MASK_SCALE = 0.5
      maskedValues[t][v] += role === 'add' ? noise : -noise;
    }
  }
}
```

### 4.4 Cancellation Proof

```
Participant A sends:  masked_A = α_A × w_A + PRG(s_AB)
Participant B sends:  masked_B = α_B × w_B − PRG(s_AB)

Server computes sum:
  Σ = masked_A + masked_B
    = α_A × w_A + PRG(s_AB) + α_B × w_B − PRG(s_AB)
    = α_A × w_A + α_B × w_B    ← masks cancel exactly
    = quality-weighted global model
```

For N participants with all pair seeds: `Σ_i masked_i = Σ_i (α_i × w_i)`.

---

## 5. Quality Protocol — Adaptive Meta-Aggregator (Section 3.4)

### 5.1 Overview

Instead of FedAvg's uniform or dataset-size-proportional weighting, the system uses a small neural network (the **AdaptiveMetaAggregator**) running on the server to compute per-client quality weights α. These weights are broadcast to clients before each round. Clients pre-scale their weights by α before masking, so the server's sum directly yields the quality-weighted global model.

### 5.2 Per-Client Feature Vector

| Feature | Symbol | Computation |
|---------|--------|-------------|
| `local_loss_norm` | f₀ | `min(loss, 5.0) / 5.0` — clamped normalised loss |
| `dataset_size_norm` | f₁ | `datasetSize / totalSamples` — this client's fraction |
| `update_consistency` | f₂ | `1 − |norm_t − norm_{t-1}| / (norm_{t-1} + ε)` — update stability [0,1] |

### 5.3 Network Architecture

```
Input: [f₀, f₁, f₂]  (3-dimensional feature vector per client)
            │
     Linear(3 → 8)
     + bias
     ReLU activation
            │
     Linear(8 → 1)
     + bias
     → scalar score_i
            │
  Cross-client softmax:
     α_i = exp(score_i) / Σ_j exp(score_j)
            │
  Output: α_i ∈ (0,1),  Σ_i α_i = 1
```

**Initialization:** He initialization for all weights. Biases initialized to 0.

**Round 1:** Uniform weights α = 1/N (no quality signal available yet).

### 5.4 Online Learning via REINFORCE

After each completed round, the aggregator updates its weights using the REINFORCE policy gradient algorithm, with Δglobal_accuracy as the reward signal.

```javascript
// federatedOrchestrator.js — AdaptiveMetaAggregator.update()

// Reward = change in global accuracy since previous round
const reward = currentAccuracy − this.prevAccuracy;

// REINFORCE update for W2 (output layer):
// dScore_i/dW2 = h_i  (gradient of score w.r.t. output weights)
// Policy gradient: Δ = lr × reward × (α_i − α_i²) × h_i
//   (using softmax gradient: dα_i/dScore_i = α_i(1 − α_i))

if (reward > 0) {
  // Reinforce the current allocation — update toward current α
  dScore = this.lr * reward * (1 - alpha);
} else {
  // Accuracy dropped — pull toward uniform (1/N)
  const uniform = 1.0 / N;
  dScore = this.lr * reward * (alpha - uniform);
}
// Backprop through ReLU into W1
```

### 5.5 α Broadcast and Pre-Scaling

```
Server → Client at round start:
  adaptiveWeights: { "company_a": 0.62, "company_b": 0.38 }

Client before masking:
  for each weight tensor t, each value v:
    w̃[t][v] = α_i × w[t][v]

Server after receiving all masked submissions:
  Σ masked_i = Σ (α_i × w_i)   ← masks already cancelled
```

---

## 6. Backend Architecture (Node.js)

### 6.1 Active File Structure

```
backend/
├── server.js                       # Entry point — http.createServer + Socket.IO init
├── package.json                    # "type": "commonjs" (explicit CJS)
├── Dockerfile
├── railway.toml
│
└── src/
    ├── app.js                      # Express bootstrap, route registration
    │
    ├── config/
    │   ├── db.js                   # MongoDB Atlas connection (mongoose)
    │   ├── env.js                  # Environment variable validation
    │   └── constants.js            # PARTICIPANT_STATUS, WS_EVENTS enums
    │
    ├── services/
    │   ├── authService.js          # JWT issuance, bcrypt password verify
    │   ├── queueService.js         # join/leave/threshold/broadcast
    │   └── federatedOrchestrator.js # Full FL lifecycle + AdaptiveMetaAggregator
    │
    ├── routes/
    │   ├── auth.routes.js          # POST /login, GET /me
    │   ├── queue.routes.js         # GET /, POST /join, POST /leave
    │   ├── Federated.routes.js     # GET /schema, /weights, /masks; POST /submit
    │   ├── model.routes.js         # GET /models, /:id, /:id/download
    │   ├── metrics.routes.js       # GET /current, /admin/current, /history
    │   ├── admin.routes.js         # GET/PUT /config, CRUD /users, GET /stats
    │   └── health.routes.js        # GET /health
    │
    ├── middleware/
    │   ├── authMiddleware.js       # JWT verification — protects all /api/* routes
    │   ├── errorHandler.js         # Centralised error formatting
    │   └── rateLimiter.js          # express-rate-limit (login: 10/15min, api: 100/15min)
    │
    ├── models/                     # Mongoose schemas
    │   ├── Company.js              # User/company identity + auth
    │   ├── TrainingJobs.js         # Job lifecycle document
    │   ├── Participant.js          # Per-job participant status
    │   ├── TrainingMetric.js       # Per-round local + global metrics
    │   ├── TrainingRound.js        # Round-level aggregation metadata
    │   ├── Models.js               # Finalized model artifacts + weightsB64
    │   └── SystemConfig.js         # Admin-writable runtime config (key/value)
    │
    ├── websocket/
    │   ├── socketHandler.js        # Socket.IO event wiring, room management
    │   └── eventEmitter.js         # Internal Node EventEmitter (service → socket bridge)
    │
    ├── scripts/
    │   └── seedCompanies.js        # One-shot DB seed for demo users
    │
    └── utils/
        └── model_converter.py      # TF.js JSON → NumPy pickle converter
```

### 6.2 Service Responsibilities

**authService.js**
Validates company credentials against the `companies` collection using `bcryptjs.compare`. Issues a signed JWT containing `{ companyId, companyName, role }` with 24-hour expiry. The `authenticate` middleware verifies this JWT on every protected route and attaches `req.company`.

**queueService.js**
Manages the pre-training waiting room. `joinQueue(companyId)` upserts a `Participant` document with `status: QUEUED`. `leaveQueue(companyId)` removes it. A polling loop (every 3 seconds) checks the queued count against `MIN_CLIENTS` from `SystemConfig`. When the threshold is met, it locks the queue (via an in-memory flag), snapshots the participant list, and fires `training:start` on the internal event emitter. Broadcasts `queue:state` via Socket.IO after every change.

**federatedOrchestrator.js**
The central state machine. Owns all in-memory training state: `activeJob`, `globalWeights`, `pendingSubmissions`, `roundSeeds`, `metaAggregator`. Exposes getter functions consumed by route handlers (`getActiveJob`, `getGlobalWeights`, `getMasksForNode`, `hasSubmittedForRound`). On `submitWeights`, when all participants have submitted, it sums the masked weights (masks cancel), stores the global model, runs the REINFORCE update on the meta-aggregator, emits `round:complete`, and either starts the next round or finalizes the job.

**SystemConfig.js**
MongoDB-backed key/value store for runtime configuration. Keys: `MIN_CLIENTS`, `DEFAULT_ROUNDS`, `LEARNING_RATE`, `ROUND_TIMEOUT_MS`. Provides `getConfig(key)` → DB value → default → null. The admin UI writes via `setConfig(key, value)`. This replaces all hardcoded environment variable fallbacks; the DB value always wins.

### 6.3 federatedOrchestrator.js — State Transitions

```
                  ┌───────────────────────────────┐
                  │         IDLE / NO JOB          │
                  └───────────────┬───────────────┘
                                  │ queueService fires training:start
                                  ▼
                  ┌───────────────────────────────┐
                  │  INITIALIZING                  │
                  │  - Read config (rounds, LR)    │
                  │  - Generate pairwise seeds      │
                  │  - Compute uniform α = 1/N      │
                  │  - Set currentRound = 1         │
                  └───────────────┬───────────────┘
                                  │ emit round:started
                          ┌───────▼────────┐
                          │  ROUND OPEN    │◄────────────────┐
                          │  waiting for   │                 │
                          │  submissions   │                 │ next round
                          └───────┬────────┘                 │
                                  │ all N submitted          │
                                  ▼                          │
                  ┌───────────────────────────────┐          │
                  │  AGGREGATING                   │          │
                  │  - Sum masked weights          │          │
                  │  - REINFORCE update (α)        │          │
                  │  - Save global metrics to DB   │          │
                  │  - Broadcast round:complete    │          │
                  └───────────────┬───────────────┘          │
                                  │                          │
                     ┌────────────┴────────────┐             │
                     │ round < totalRounds      │             │
                     ▼                          ▼             │
             ┌──────────────┐       ┌──────────────────────┐ │
             │ NEXT ROUND   │───────►│ Increment counter    │─┘
             └──────────────┘       │ Broadcast round:start │
                                    └──────────────────────┘
                     │ round == totalRounds
                     ▼
                  ┌───────────────────────────────┐
                  │  FINALIZING                    │
                  │  - Save Model doc (weightsB64) │
                  │  - Update Participants → DONE  │
                  │  - Broadcast training:complete │
                  └───────────────┬───────────────┘
                                  ▼
                  ┌───────────────────────────────┐
                  │  COMPLETE — job archived       │
                  └───────────────────────────────┘
```

---

## 7. Frontend Architecture (React + TF.js)

### 7.1 Technology Stack

| Technology | Version | Role |
|------------|---------|------|
| React | 19 | UI framework |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4 | Styling |
| Vite | 6.x | Build tool + dev server |
| TensorFlow.js | Latest | In-browser ML |
| Socket.IO Client | 4.x | Real-time events |
| Axios | 1.x | HTTP client |
| Lucide React | 0.383 | Icons |
| Framer Motion | Latest | Animations |

### 7.2 Active File Structure

```
frontend/
├── Dockerfile
├── nginx.conf                      # Production static file server
├── railway.toml
├── vite.config.ts
├── tsconfig.json
├── index.html
│
└── src/
    ├── main.tsx                    # React DOM root
    ├── App.tsx                     # Router, auth guards, layout shells
    ├── index.css                   # Tailwind base
    │
    ├── config/
    │   └── api.ts                  # Axios instance + typed API methods
    │
    ├── context/
    │   ├── AuthContext.tsx         # JWT storage, login/logout, useAuth hook
    │   ├── SocketContext.tsx       # Socket.IO connection, reconnect, useSocket hook
    │   └── QueueContext.tsx        # Queue state shared across components
    │
    ├── components/
    │   ├── Sidebar.tsx             # Navigation sidebar
    │   └── ParticipantPicker.tsx   # Login / identity selection UI
    │
    ├── pages/
    │   ├── Login.tsx               # /login — JWT auth entry point
    │   ├── Dashboard.tsx           # / — metrics charts, node performance
    │   ├── Queue.tsx               # /queue — waiting room + active training
    │   ├── Models.tsx              # /models — trained model list + download
    │   └── AdminDashboard.tsx      # /admin — config + user management
    │
    └── services/
        ├── localTrainer.ts         # TF.js model build, train, mask, export
        └── trainingWorker.ts       # Web Worker wrapper for localTrainer
```

### 7.3 Page Descriptions

**Login (`/login`)**
Email + password authentication. On success: JWT stored, redirect to `/` or `/admin` based on role. Shows platform title "Federated Learning — Intrusion Detection System".

**Dashboard (`/`)**
Shows global training metrics (accuracy + loss per round, line charts) and personal node metrics (local accuracy, loss, dataset size, training duration). Pulls from `GET /api/metrics/current`. Falls back to most recent completed job when no active job is running — dashboard always shows data.

**Queue (`/queue`)**
The core training interaction page. Two modes:
- **Waiting room:** Join/Leave queue, live participant list, slot counter
- **Active training:** CSV drag-and-drop, local training progress (epoch by epoch), round status, submit button, waiting indicator between rounds

CSV parsing, model training, masking, and submission all happen within this page via the Web Worker. No page navigation occurs during a training job — users stay here for all N rounds.

**Models (`/models`)**
Lists all models the logged-in user participated in training. Shows accuracy, loss, round count, participants. Download button triggers the on-demand `.pkl` conversion and file stream.

**AdminDashboard (`/admin`)**
Admin-only page (role guard). Two tabs:
- **Training Config:** Adjust `MIN_CLIENTS`, `DEFAULT_ROUNDS`, `LEARNING_RATE` with live controls (stepper + slider). Saves to MongoDB via `PUT /api/admin/config`. Changes take effect on the next training job.
- **Manage Users:** Add new participant accounts, delete existing ones, view all users with role badges.

### 7.4 Web Worker Architecture (trainingWorker.ts)

Training is offloaded to a Web Worker to prevent blocking the UI thread. The main thread (Queue.tsx) sends messages; the worker responds with progress events.

```
Main Thread (Queue.tsx)                Web Worker (trainingWorker.ts)
        │                                        │
        │──{ type:'INIT_TF' }────────────────────►│
        │◄─{ type:'TF_READY' }────────────────────│
        │                                        │
        │──{ type:'LOAD_CSV', csvText }───────────►│
        │◄─{ type:'CSV_LOADED', meta }────────────│
        │                                        │
        │──{ type:'APPLY_GLOBAL_WEIGHTS', weights}►│
        │                                        │
        │──{ type:'TRAIN', epochs, batchSize }────►│
        │◄─{ type:'EPOCH_END', epoch, acc, loss }─│  (streaming)
        │◄─{ type:'TRAIN_COMPLETE', metrics }─────│
        │                                        │
        │──{ type:'APPLY_MASK', assignments, α }──►│
        │◄─{ type:'MASK_COMPLETE', maskedWeights }─│
```

**TF.js Backend Selection:** The worker explicitly sets TF.js to use the `cpu` backend (not WebGL) because Web Workers do not have access to a canvas element, which WebGL requires silently in some environments.

---

## 8. MongoDB Schema

### 8.1 Collection: `companies`

```javascript
{
  _id:          ObjectId,
  companyId:    String,      // "mohammad" — unique login key
  companyName:  String,      // "Mohammad HTU"
  email:        String,      // login email (lowercase)
  passwordHash: String,      // bcryptjs hash
  role:         String,      // "client" | "admin"
  apiKey:       String,      // reserved for future API access
  isActive:     Boolean,
  createdAt:    Date,
  lastLoginAt:  Date,
}

Indexes: { companyId: 1 } unique, { email: 1 } unique
```

### 8.2 Collection: `trainingjobs`

```javascript
{
  _id:             ObjectId,
  jobId:           String,      // UUID v4
  status:          String,      // INITIALIZING | ROUND_IN_PROGRESS | COMPLETE | FAILED
  currentRound:    Number,      // 1-based
  totalRounds:     Number,      // from SystemConfig.DEFAULT_ROUNDS at job start
  participantIds:  [String],    // companyIds
  adaptiveWeights: Object,      // { companyId: alpha } — current round α values
  roomId:          String,      // Socket.IO room identifier
  startedAt:       Date,
  completedAt:     Date,
}

Indexes: { status: 1 }, { createdAt: -1 }
```

### 8.3 Collection: `participants`

```javascript
{
  _id:            ObjectId,
  jobId:          String,   // ref: trainingjobs.jobId
  companyId:      String,   // ref: companies.companyId
  status:         String,   // QUEUED | TRAINING | SUBMITTED | DISCONNECTED | DONE
  joinedQueueAt:  Date,
  lastHeartbeatAt:Date,
  roundsCompleted:Number,
  currentRound:   Number,
  datasetSize:    Number,   // self-reported, used in meta-aggregator feature f₁
}

Indexes: { jobId: 1, companyId: 1 } unique, { status: 1 }
```

### 8.4 Collection: `trainingmetrics`

```javascript
{
  _id:               ObjectId,
  jobId:             String,
  type:              String,    // "local" | "global"
  companyId:         String,    // null for type:"global"
  round:             Number,
  accuracy:          Number,
  loss:              Number,
  f1Score:           Number,    // global only
  precision:         Number,    // global only
  recall:            Number,    // global only
  datasetSize:       Number,    // local only
  durationMs:        Number,    // local only — training wall time
  epochsRun:         Number,    // local only
  updateNorm:        Number,    // local only — L2 norm of weight update
  updateConsistency: Number,    // local only — stability metric [0,1]
  createdAt:         Date,
}

Indexes: { jobId: 1, type: 1 }, { companyId: 1, type: 1, createdAt: -1 }
```

### 8.5 Collection: `trainingrounds`

```javascript
{
  _id:                    ObjectId,
  jobId:                  String,
  roundNumber:            Number,
  status:                 String,   // IN_PROGRESS | AGGREGATING | COMPLETE
  participantsExpected:   [String],
  participantsSubmitted:  [String],
  aggregationMetrics: {
    avgLoss:       Number,
    avgAccuracy:   Number,
    adaptiveAlpha: Object,          // { companyId: alpha } used this round
  },
  startedAt:    Date,
  completedAt:  Date,
}

Indexes: { jobId: 1, roundNumber: 1 } unique
```

### 8.6 Collection: `models`

```javascript
{
  _id:          ObjectId,
  modelId:      String,      // "model_<jobId>_final"
  jobId:        String,
  version:      String,      // "1.0.0"
  status:       String,      // "AVAILABLE" | "PENDING" | "ARCHIVED"
  architecture: String,      // "IDSNet_v2"
  weightsB64:   String,      // base64-encoded JSON {shapes, values} — TF.js format
  checksum:     String,      // SHA-256 of weightsB64
  sizeBytes:    Number,
  participants: [String],    // companyIds — download access gate
  trainingMetrics: {
    finalAccuracy:     Number,
    finalLoss:         Number,
    roundsCompleted:   Number,
    totalParticipants: Number,
  },
  createdAt: Date,
}

Indexes: { jobId: 1 }, { status: 1 }, { participants: 1 }
```

### 8.7 Collection: `systemconfigs`

```javascript
{
  _id:       ObjectId,
  key:       String,    // "MIN_CLIENTS" | "DEFAULT_ROUNDS" | "LEARNING_RATE" | "ROUND_TIMEOUT_MS"
  value:     Mixed,     // Number (all current keys)
  updatedBy: String,    // companyId of admin who last changed it
  updatedAt: Date,
}

Defaults (used when no DB document exists for a key):
  MIN_CLIENTS:      2
  DEFAULT_ROUNDS:   5
  LEARNING_RATE:    0.001   (AdaptiveMetaAggregator lr)
  ROUND_TIMEOUT_MS: 600000  (10 minutes)

Indexes: { key: 1 } unique
```

> **Config precedence:** DB document → hardcoded DEFAULTS → null. Admin `PUT /api/admin/config` writes to this collection. The orchestrator reads `LEARNING_RATE` here at job start to instantiate `new AdaptiveMetaAggregator(configLR)`. Changes take effect on the **next** job, not mid-training.

---

## 9. API Endpoints

### 9.1 Authentication (`/api/auth`)

```
POST /api/auth/login
  Body:    { email: string, password: string }
  Returns: { token: string, company: { companyId, companyName, role } }
  Errors:  401 Invalid credentials | 403 Account inactive

GET /api/auth/me
  Headers: Authorization: Bearer <token>
  Returns: { company: { companyId, companyName, role } }
```

### 9.2 Queue (`/api/queue`)

```
GET /api/queue
  Headers: Authorization: Bearer <token>
  Returns: {
    participants: [{ companyId, companyName, joinedAt }],
    count: number,
    minRequired: number,          // from SystemConfig.MIN_CLIENTS
    readyToStart: boolean,
    activeJob: {                  // only if caller is a participant in this job
      jobId, status, currentRound, totalRounds
    } | null
  }
  Note: activeJob is scoped — non-participants receive null

POST /api/queue/join
  Headers: Authorization: Bearer <token>
  Returns: { joined: true, position: number, queueState: {...} }

POST /api/queue/leave
  Headers: Authorization: Bearer <token>
  Returns: { left: true }
```

### 9.3 Federated (`/api/federated`)

```
GET /api/federated/schema
  Headers: Authorization: Bearer <token>
  Returns: { schema: ["BENIGN", "DoS Hulk", "PortScan", "DDoS", "FTP-Patator", "Bot"] }
  Note: Cache-Control: no-store

GET /api/federated/weights
  Headers: Authorization: Bearer <token>
  Returns: {
    hasWeights: boolean,
    jobId: string,
    currentRound: number,
    totalRounds: number,
    weights: { shapes: number[][], values: number[][] } | null,
    adaptiveWeights: { [companyId]: number } | null,
    alreadySubmitted: boolean
  }
  Errors:  404 No active job | 404 Not a participant (membership check)
  Note:    Cache-Control: no-store, Pragma: no-cache

GET /api/federated/masks
  Headers: Authorization: Bearer <token>
  Returns: {
    jobId: string,
    round: number,
    assignments: [{ peerId: string, seed: number, role: "add"|"sub" }]
  }
  Errors:  404 No active job | 403 Not a participant
  Note:    Cache-Control: no-store

POST /api/federated/submit
  Headers: Authorization: Bearer <token>
  Body:    {
    jobId: string,
    round: number,
    maskedWeights: { shapes: number[][], values: number[][] },
    metrics: { accuracy, loss, datasetSize, updateConsistency, updateNorm, durationMs }
  }
  Returns: { accepted: true, received: number, expected: number, companyId, round }
  Errors:  400 Missing fields | 409 Duplicate submission | 409 Wrong round/job
```

### 9.4 Models (`/api/models`)

```
GET /api/models
  Headers: Authorization: Bearer <token>
  Returns: Array of model summaries (participants-gated, no weightsB64 in list)

GET /api/models/:modelId
  Headers: Authorization: Bearer <token>
  Returns: Model detail { modelId, jobId, version, status, metrics, participants, hasWeights }
  Errors:  404 Not found | 403 Not a participant

GET /api/models/:modelId/download
  Headers: Authorization: Bearer <token>
  Returns: Binary stream (.pkl) — Python pickle of NumPy arrays
           Headers: Content-Disposition: attachment; filename="<modelId>_v<ver>.pkl"
                    X-Model-Architecture, X-Model-Version, X-Final-Accuracy, X-Model-Format
  Fallback: If Python conversion fails → raw weights JSON download
  Errors:  403 Not a participant | 404 Not found
```

### 9.5 Metrics (`/api/metrics`)

```
GET /api/metrics/current
  Headers: Authorization: Bearer <token>
  Returns: {
    jobId: string,
    rounds: [{ round, accuracy, loss, f1Score, precision, recall }],  // global
    myMetrics: [{ round, accuracy, loss, datasetSize, durationMs }],  // local
    maxRound: number
  }
  Note: Falls back to most recent completed job when no active job running

GET /api/metrics/history
  Headers: Authorization: Bearer <token>
  Returns: Array of past job summaries for this company
```

### 9.6 Admin (`/api/admin`) — Admin role required

```
GET /api/admin/stats
  Returns: { totalUsers, totalModels, totalJobs, config: { MIN_CLIENTS, DEFAULT_ROUNDS, LEARNING_RATE } }

GET /api/admin/config
  Returns: { MIN_CLIENTS, DEFAULT_ROUNDS, LEARNING_RATE, ROUND_TIMEOUT_MS }

PUT /api/admin/config
  Body:    { MIN_CLIENTS?: number, DEFAULT_ROUNDS?: number, LEARNING_RATE?: number }
  Returns: { saved: true, config: {...} }
  Emits:   WebSocket 'config:updated' to all connected clients
  Validation:
    MIN_CLIENTS:    integer, 2–10
    DEFAULT_ROUNDS: integer, 1–50
    LEARNING_RATE:  float, 0–1 (exclusive)

GET /api/admin/users
  Returns: Array of all companies (no passwordHash/apiKey)

POST /api/admin/users
  Body:    { companyId, companyName, email, password, role }
  Returns: { created: true, user: {...} }

DELETE /api/admin/users/:companyId
  Returns: { deleted: true, companyId }
  Errors:  400 Cannot delete own account
```

### 9.7 Health (`/health`)

```
GET /health
  Returns: { status: "ok", db: "connected", timestamp: ISO8601 }
```

---

## 10. WebSocket Event Catalog

All events are delivered via Socket.IO. Clients connect on page load via `SocketContext.tsx`.

| Event | Direction | Payload | Consumer |
|-------|-----------|---------|----------|
| `queue:state` | Server → All | `{ participants[], count, minRequired, readyToStart }` | Queue page |
| `round:started` | Server → Participants | `{ jobId, round, totalRounds }` | Queue page |
| `weights:received` | Server → Participants | `{ jobId, round, received, expected }` | Queue page |
| `round:complete` | Server → Participants | `{ jobId, round, metrics: { accuracy, loss } }` | Queue page |
| `training:complete` | Server → Participants | `{ jobId, modelId }` | Queue page |
| `config:updated` | Server → All | `{ config: { MIN_CLIENTS, DEFAULT_ROUNDS, LEARNING_RATE } }` | Admin UI |
| `ping` (heartbeat) | Client → Server | `{}` | Every 20s — prevents Railway TCP idle timeout |

**Room scoping:** Socket.IO rooms are used to ensure that `round:started`, `weights:received`, `round:complete`, and `training:complete` events are only sent to the participants of the current training job. Non-participants in the waiting room receive `queue:state` only.

**Reconnection handling:** `SocketContext.tsx` configures exponential backoff reconnection. On reconnect, `Queue.tsx` re-polls `GET /api/federated/weights` to recover `alreadySubmitted` state and `lastSubmittedRoundRef`, preventing duplicate submissions after a network hiccup.

---

## 11. IDS Neural Network Architecture

### 11.1 Input and Output

| Property | Value |
|----------|-------|
| Input features | 56 (CICIDS2017 network flow statistics) |
| Output classes | 6 (BENIGN, DoS Hulk, PortScan, DDoS, FTP-Patator, Bot) |
| Dataset format | CICIDS2017-style CSV — one row per flow |
| Label encoding | String → integer index (mapped against global schema) |
| Label dtype | float32 (required by TF.js `sparseCategoricalCrossentropy`) |

### 11.2 Model Architecture

```
Input Layer           [56 features]
        │
Dense(128, relu)      + GlorotUniform init
BatchNormalization    stabilises training across heterogeneous company datasets
Dropout(0.3)          regularisation
        │
Dense(64, relu)
Dropout(0.2)
        │
Dense(32, relu)
        │
Dense(6, softmax)     output — one logit per class
        │
        Output        [6 class probabilities]
```

**Binary fallback:** If only 2 unique classes are present in a dataset, the output layer uses `sigmoid` + `binaryCrossentropy` instead.

### 11.3 Training Hyperparameters (defaults)

| Parameter | Value | Source |
|-----------|-------|--------|
| Optimizer | Adam | hardcoded |
| Learning rate | 0.001 | hardcoded (local training) |
| Loss | sparseCategoricalCrossentropy | hardcoded |
| Epochs | 3 | Queue.tsx constant |
| Batch size | 32 | Queue.tsx constant |
| Validation split | 0.1 | localTrainer.ts |
| Meta-aggregator lr | 0.001–0.05 | SystemConfig `LEARNING_RATE` (admin-configurable) |

### 11.4 Model Freshness Guarantee

At the start of every round after round 1, the browser **rebuilds the model architecture from scratch** and then applies the global weights. This gives a fresh Adam optimizer (clearing all momentum/variance state from the previous round). Without this, stale optimizer state from round 1 destabilizes training from round 3 onward.

```typescript
// localTrainer.ts — applyGlobalWeights()
this.buildModel();                    // fresh architecture + fresh Adam
const tensors = globalWeights.shapes.map((shape, i) =>
  tf.tensor(globalWeights.values[i], shape, 'float32')
);
this.model!.setWeights(tensors);      // apply received global weights
```

---

## 12. Model Export Pipeline

### 12.1 Storage Format

Global model weights are stored in MongoDB as a base64-encoded JSON blob:

```json
{
  "shapes": [[56, 128], [128], [128, 64], ...],
  "values": [[0.012, -0.034, ...], [0.001, ...], ...]
}
```

This matches the TF.js `model.getWeights()` output format. The `weightsB64` field is excluded from all list/detail API responses (`select('-weightsB64')`) to prevent large payloads. It is only fetched during the download endpoint.

### 12.2 On-Demand Conversion

```
Browser: GET /api/models/:modelId/download
          │
Node: Fetch model doc with weightsB64 from MongoDB
      Decode base64 → JSON string
      Write to temp file: /tmp/flmodel-XXXX/weights.json
          │
          ▼
    execSync: python3 model_converter.py
                       weights.json    (input)
                       model.pkl       (output)
                       finalAccuracy
                       "participant_a,participant_b"
          │
Python: Parse JSON → reconstruct NumPy arrays per shape
        Build metadata dict {accuracy, participants, architecture, ...}
        pickle.dump({weights: [...], metadata: {...}}) → model.pkl
          │
Node: Read model.pkl into Buffer
      Delete weights.json, model.pkl, temp dir
      Stream Buffer → client as application/octet-stream
```

### 12.3 Python Pickle Structure

The output `.pkl` file, when loaded with `pickle.load()`, contains:

```python
{
  "weights": [np.ndarray, ...],   # one array per layer, matching shapes
  "metadata": {
    "architecture": "IDSNet_v2",
    "framework": "TensorFlow.js → Python pickle",
    "final_accuracy": 0.9234,
    "participants": ["mohammad", "amer"],
    "created_at": "2026-05-31T...",
    "layer_shapes": [[56, 128], [128], ...],
  }
}
```

**Fallback:** If Python conversion fails (numpy not available, timeout, etc.), the raw weights JSON is served instead as a `.json` attachment with no silent failure.

---

## 13. Training Queue Logic

### 13.1 Queue State Machine

```
POST /api/queue/join
        │
        ▼
┌─────────────────────┐
│  Participant upsert  │  status: QUEUED, jobId: null
│  in MongoDB          │
└──────────┬──────────┘
           │
           ▼
  queueService polls every 3 seconds
  GET participants WHERE status='QUEUED'
           │
           ├── count < MIN_CLIENTS ──► broadcast queue:state "waiting for N more"
           │
           └── count >= MIN_CLIENTS
                       │
                       ▼
              Check in-memory isStartingJob flag (race condition guard)
                       │
                       ▼
              Snapshot participant list
              Create TrainingJob {status: INITIALIZING}
              Update Participants {status: TRAINING, jobId}
              Set isStartingJob = true
                       │
                       ▼
              federatedOrchestrator.startJob(participantIds)
                  - read config (rounds, LR)
                  - generate pairwise seeds
                  - set α = 1/N
                  - emit internal 'training:start'
                  - Socket.IO broadcast 'round:started'
                       │
                       ▼
              isStartingJob = false
```

### 13.2 Minimum Client Enforcement

- `MIN_CLIENTS` is stored in `SystemConfig` and readable by `getConfig('MIN_CLIENTS')`. The admin can change it live; it takes effect on the next queue threshold check (within 3 seconds).
- The `isStartingJob` boolean flag prevents double-start in the event the poll fires twice before the async job creation completes.
- Companies that join after a job has already started are placed in the queue for the next job (their `Participant` record stays `QUEUED` with `jobId: null`).

### 13.3 Participant Lifecycle

```
QUEUED ──► TRAINING ──► SUBMITTED ──► DONE
                │
                └──► DISCONNECTED (timeout / socket drop)
                         │
                         └──► If remaining >= MIN_CLIENTS:
                              aggregation proceeds without them
                         └──► If remaining < MIN_CLIENTS:
                              job fails with INSUFFICIENT_PARTICIPANTS
```

---

## 14. Admin Control System

### 14.1 Configurable Parameters

| Key | Type | Range | Effect |
|-----|------|-------|--------|
| `MIN_CLIENTS` | integer | 2–10 | Minimum participants before training auto-starts |
| `DEFAULT_ROUNDS` | integer | 1–50 | Number of FL rounds per session |
| `LEARNING_RATE` | float | 0–1 (exclusive) | AdaptiveMetaAggregator REINFORCE step size |

All three are persisted in MongoDB `systemconfigs` collection. After a successful `PUT /api/admin/config`, the server emits a `config:updated` WebSocket event to all connected clients so they can refresh displayed values without a page reload.

### 14.2 Config Read Path

```
federatedOrchestrator.startJob()
    │
    ├── totalRounds  = await getConfig('DEFAULT_ROUNDS')  // DB → 5 → null
    ├── minClients   = await getConfig('MIN_CLIENTS')     // DB → 2 → null
    └── configLR     = await getConfig('LEARNING_RATE')   // DB → 0.001 → null

    metaAggregator = new AdaptiveMetaAggregator(configLR ?? 0.05)
```

The config is read **at job start**, not continuously. Changes apply to the next job only.

### 14.3 Admin User Management

Admin users can via the UI:
- **Add users** with arbitrary `companyId`, `companyName`, email, password, and role
- **Delete users** (cannot delete own account)
- **View all users** with active/inactive status and role badges
- **View system stats**: total client users, trained models, completed training jobs

---

## 15. Deployment Architecture (Railway)

### 15.1 Service Layout

```
┌─────────────────────────────────────────────────────────────┐
│                         Railway                             │
│                                                             │
│  ┌────────────────────────────┐  ┌────────────────────────┐ │
│  │  frontend service          │  │  backend service       │ │
│  │  nginx:alpine              │  │  node:22-alpine        │ │
│  │  Serves React SPA          │  │  Express + Socket.IO   │ │
│  │  /frontend/Dockerfile      │  │  /backend/Dockerfile   │ │
│  │                            │  │                        │ │
│  │  PORT: auto (Railway)      │  │  PORT: auto (Railway)  │ │
│  │  URL: front-end-production │  │  URL: earnest-heart-   │ │
│  │       -8cbe.up.railway.app │  │       production.up.   │ │
│  │                            │  │       railway.app      │ │
│  └────────────────────────────┘  └────────────┬───────────┘ │
│                                               │             │
└───────────────────────────────────────────────┼─────────────┘
                                                │  TLS
                                                ▼
                               ┌────────────────────────────┐
                               │     MongoDB Atlas          │
                               │     (cloud-hosted)         │
                               │     MONGODB_URI env var    │
                               └────────────────────────────┘
```

### 15.2 Frontend Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

`nginx.conf` serves the React SPA and handles `try_files $uri /index.html` for client-side routing.

### 15.3 Backend Dockerfile

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
COPY server.js ./
EXPOSE 4000
CMD ["node", "server.js"]
```

**Important:** `package-lock.json` is excluded from the repo to avoid Docker layer caching causing `npm install` to be skipped entirely on dependency changes.

### 15.4 Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `MONGODB_URI` | Backend | MongoDB Atlas connection string |
| `JWT_SECRET` | Backend | Secret for JWT signing (32+ chars) |
| `NODE_ENV` | Backend | `production` |
| `PORT` | Backend | Injected by Railway automatically |
| `VITE_API_URL` | Frontend (build) | Backend base URL |

### 15.5 Key Railway Lessons Learned

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| `npm install` skipped | `package-lock.json` in repo caused Docker layer cache hit | Remove `package-lock.json` from git tracking |
| Socket.IO events never reach browser | `http.createServer()` not passed to Socket.IO; using bare `app.listen()` | Create `http.Server(app)` explicitly; call `setupWebSocket(io)` |
| `await` at module top level crashes | `await` placed outside async function in CJS module | Wrap in IIFE or move to async function |
| ESM/CJS conflicts | `bcryptjs@3` is pure ESM; Node CJS `require()` fails | Add `"type": "commonjs"` to `package.json`; pin bcryptjs to compatible version |
| `MODULE_NOT_FOUND` crash | Deleted route files still `require()`d in `app.js` | Remove both the `require()` and `app.use()` lines together |

---

## 16. Security Model

### 16.1 Authentication & Authorization

- All `/api/*` routes are protected by `authMiddleware.js` (JWT verification)
- Admin-only routes enforce `role === 'admin'` check after JWT verification
- Login endpoint has a separate stricter rate limiter: **10 attempts per 15 minutes per IP**
- General API rate limiter: **100 requests per 15 minutes per IP**
- `helmet` middleware sets security headers (XSS protection, no content sniffing, etc.)

### 16.2 Privacy Guarantees

| Property | Mechanism |
|----------|-----------|
| Raw data never uploaded | CSV parsed in browser Web Worker; no HTTP upload |
| Individual weights never exposed | Pairwise masking — server only sees masked sums |
| Server cannot reconstruct individual updates | Masks use independent random seeds per pair per round |
| Global model weights gated | Download requires participant membership check in DB |

### 16.3 Data Minimization

- Weight tensors in MongoDB are deleted after job completion and download (future: TTL index)
- `weightsB64` is excluded from all list/detail API responses via Mongoose `.select('-weightsB64')`
- Temp files from `.pkl` conversion are deleted immediately after streaming (try/finally)
- Round-level weight data is never persisted; only the final aggregated global model is stored

### 16.4 Transport Security

- All traffic served over HTTPS (Railway provides TLS termination automatically)
- Socket.IO connects over WSS (secure WebSocket) in production
- CORS configured to allow the Railway frontend origin only

---

## Appendix A: Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ML compute location | Browser (TF.js) | Eliminates Python service; raw data stays local; no infrastructure for participants |
| Aggregation algorithm | Pairwise Masking + Adaptive Meta-Aggregator | Privacy + quality over simple FedAvg; aligns with Chen et al. 2020 |
| Weight communication | Browser POST masked JSON → Node sum | No intermediate storage; server sees only aggregate |
| Model persistence | Base64 in MongoDB | No shared filesystem needed; Atlas handles replication |
| Model download format | Python pickle (.pkl) | Single `pickle.load()` in any Python ML stack; no TF.js required to consume the model |
| Config storage | MongoDB SystemConfig | Live admin changes without redeployment |
| WebSocket library | Socket.IO | Rooms, auto-reconnect, fallback transports built-in |
| Deployment | Railway (2 services) | Managed TLS, auto-redeploy from GitHub, no Docker Compose maintenance |
| Queue trigger | DB poll every 3s + in-memory lock | Simple, reliable; Redis not needed at this scale |
| Python conversion | On-demand at download time | Keeps training pipeline clean; no eager conversion cost |

## Appendix B: Paper Mapping

| Paper Section | Implementation |
|--------------|----------------|
| Section 3.3 — Pairwise Masking | `federatedOrchestrator.js` `_generateRoundSeeds()` + `localTrainer.ts` `applyPairwiseMask()` |
| Section 3.4 — Adaptive Meta-Aggregator | `AdaptiveMetaAggregator` class in `federatedOrchestrator.js` |
| Section 3.4 — Feature vector [loss_norm, size_norm, consistency] | `AdaptiveMetaAggregator.computeWeights()` |
| Section 3.4 — REINFORCE online learning | `AdaptiveMetaAggregator.update(currentAccuracy)` |
| Section 3.4 — α pre-scaling before masking | `localTrainer.ts` `applyGlobalWeightsAndScale()` |
| Section 3.3 — Mulberry32 PRNG (identical both sides) | `mulberry32()` in both `federatedOrchestrator.js` and `localTrainer.ts` |

---

*Document version 2.0 — FL-IDS Web Platform Architecture · HTU Capstone Project*
*Paper: Chen et al. (2020) — Privacy-Preserving IDS Using Federated Learning*
