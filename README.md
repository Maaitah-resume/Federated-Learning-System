# FL-IDS Web Platform — Production Architecture Design

**Federated Learning Intrusion Detection System**
**Document Type:** System Architecture & Design Specification
**Role:** Senior Distributed Systems Architect & ML Engineer

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Federated Training Workflow](#2-federated-training-workflow)
3. [Backend Architecture (Node.js)](#3-backend-architecture-nodejs)
4. [Python ML Service](#4-python-ml-service)
5. [MongoDB Schema](#5-mongodb-schema)
6. [API Endpoints](#6-api-endpoints)
7. [Frontend Pages](#7-frontend-pages)
8. [Training Queue Logic](#8-training-queue-logic)
9. [Federated Training Orchestration](#9-federated-training-orchestration)
10. [Deployment Architecture](#10-deployment-architecture)
11. [Development Roadmap](#11-development-roadmap)

---

## 1. High-Level Architecture

### 1.1 System Overview

The FL-IDS platform is composed of four primary tiers. Each tier is isolated in its own container and communicates through well-defined interfaces.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        COMPANY BROWSER                              │
│                     React SPA (Port 3000)                           │
│   Login │ Queue Dashboard │ Training Status │ Model Download        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  HTTPS / WSS
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NODE.JS API SERVER (Port 4000)                   │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ Auth Service│  │ Queue Service│  │  Training Orchestrator    │  │
│  └─────────────┘  └──────────────┘  └───────────────────────────┘  │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ Job Manager │  │Model Registry│  │  WebSocket Event Manager  │  │
│  └─────────────┘  └──────────────┘  └───────────────────────────┘  │
└───────────────┬─────────────────────────────┬───────────────────────┘
                │  Mongoose ODM               │  REST (internal)
                ▼                             ▼
┌───────────────────────┐      ┌──────────────────────────────────────┐
│   MONGODB (Port 27017)│      │     PYTHON FL SERVER (Port 8000)     │
│                       │      │                                      │
│  companies            │      │  ┌────────────────────────────────┐  │
│  training_jobs        │      │  │  FastAPI Endpoints             │  │
│  participants         │      │  │  /initialize  /distribute      │  │
│  models               │      │  │  /aggregate   /status          │  │
│  training_rounds      │      │  └────────────────────────────────┘  │
│  weight_snapshots     │      │  ┌────────────────────────────────┐  │
│                       │      │  │  FL Core                       │  │
└───────────────────────┘      │  │  FedAvg Aggregator             │  │
                               │  │  PyTorch Model Manager         │  │
                               │  │  Round Controller              │  │
                               │  └────────────────────────────────┘  │
                               └──────────────────────────────────────┘
```

### 1.2 Component Descriptions

**React Client**
The single-page application served to each company's browser. It handles authentication, real-time training status via WebSocket, queue visibility, and model downloads. It never communicates directly with the Python service.

**Node.js API Server**
The central orchestration layer. It manages authentication, the training queue, job lifecycle, and acts as the secure gateway between the frontend and the Python ML service. It owns all business logic.

**MongoDB**
The persistent store for company identities, training jobs, round history, weight snapshots references, and model metadata. It is the single source of truth for job state.

**Python FL Server (FastAPI)**
The machine learning microservice. It exposes REST endpoints for the Node server to call. It handles global model initialization, model distribution to clients, receiving local weights, running FedAvg aggregation, and saving the final model artifact.

**Client Training Agents**
Each company runs a local training agent (Python script) on their own infrastructure. The agent receives the global model, trains on local data, and pushes weight updates back to the Node server, which forwards them to the Python FL server.

---

## 2. Federated Training Workflow

### 2.1 Step-by-Step Flow

```
STEP 1 — Company Login
────────────────────────────────────────────────────────
  Company Browser ──POST /auth/login──► Node Auth Service
  Node Auth Service ──lookup──► MongoDB (companies)
  MongoDB ──company record──► Node Auth Service
  Node Auth Service ──JWT token──► Company Browser

STEP 2 — Join Queue
────────────────────────────────────────────────────────
  Company Browser ──POST /queue/join──► Node Queue Service
  Node Queue Service ──upsert participant──► MongoDB
  Node Queue Service ──broadcast queue state──► All WebSocket clients
  [Queue Dashboard updates in real time for all waiting companies]

STEP 3 — Training Auto-Start (Queue Threshold Met)
────────────────────────────────────────────────────────
  Queue Service ──checks participant count every 10s──► MongoDB
  When count >= MIN_CLIENTS (configurable, default: 3):
  Queue Service ──creates TrainingJob record──► MongoDB
  Queue Service ──notifies Orchestrator──► Training Orchestrator
  WebSocket broadcast: "Training is starting..."

STEP 4 — Global Model Initialization
────────────────────────────────────────────────────────
  Training Orchestrator ──POST /fl/initialize──► Python FL Server
  Python FL Server ──instantiates model architecture──► PyTorch
  Python FL Server ──returns model_version + serialized weights──► Node
  Node ──updates TrainingJob (status: ROUND_IN_PROGRESS)──► MongoDB

STEP 5 — Model Distribution
────────────────────────────────────────────────────────
  Training Orchestrator ──for each participant company:
      ──POST /fl/distribute {weights, round_number}──► Python FL Server
      Python FL Server ──returns presigned URL / base64 weights──► Node
      Node ──WebSocket push to company: "Download your round model"──► Browser
      Company Browser ──fetches model weights via GET /training/model──► Node

STEP 6 — Local Training
────────────────────────────────────────────────────────
  [On company's own infrastructure]
  Client Training Agent ──loads received global model weights
  Client Training Agent ──trains on local network log dataset
  Client Training Agent ──extracts updated weight delta
  Client Training Agent ──POST /training/submit-weights {job_id, round, weights}──► Node

STEP 7 — Weight Collection & Aggregation
────────────────────────────────────────────────────────
  Node ──stores encrypted weights reference──► MongoDB (weight_snapshots)
  Node ──waits until all participants submitted weights for this round
  When all weights received:
  Node ──POST /fl/aggregate {job_id, round, weight_refs[]}──► Python FL Server
  Python FL Server ──runs FedAvg (weighted average by dataset size)
  Python FL Server ──updates global model in memory
  Python FL Server ──returns aggregation metrics (loss, accuracy delta)──► Node
  Node ──updates TrainingRound record (status: COMPLETE)──► MongoDB

STEP 8 — Round Loop
────────────────────────────────────────────────────────
  If current_round < total_rounds:
      Orchestrator increments round counter
      Go to STEP 5
  Else:
      Go to STEP 9

STEP 9 — Final Model Generation
────────────────────────────────────────────────────────
  Node ──POST /fl/finalize {job_id}──► Python FL Server
  Python FL Server ──saves global_model.pt to persistent volume
  Python FL Server ──returns model_artifact_path + checksum──► Node
  Node ──updates Model record (status: AVAILABLE)──► MongoDB
  WebSocket broadcast to all participants: "Training complete. Model ready."

STEP 10 — Model Download
────────────────────────────────────────────────────────
  Company Browser ──GET /models/{job_id}/download──► Node Model Registry
  Node ──verifies company is a participant of this job──► MongoDB
  Node ──streams global_model.pt from volume──► Company Browser
  Company deploys trained_model.pt for local inference
```

### 2.2 Data Flow Diagram

```
Company A Browser          Node.js Server          Python FL Server
      │                         │                         │
      │──── POST /login ────────►│                         │
      │◄─── JWT ────────────────│                         │
      │                         │                         │
      │──── POST /queue/join ───►│                         │
      │◄─── WS: queue state ────│                         │
      │                         │                         │
      │    [threshold met]       │                         │
      │◄─── WS: training start ─│                         │
      │                         │──── POST /fl/init ──────►│
      │                         │◄─── model weights ───────│
      │                         │                         │
      │◄─── WS: round 1 model ─│                         │
      │──── GET /training/model ►│                         │
      │◄─── weights payload ────│                         │
      │                         │                         │
      │  [local training runs]   │                         │
      │                         │                         │
      │──── POST /submit-weights►│                         │
      │                         │──── POST /fl/aggregate ─►│
      │                         │◄─── aggregated weights ──│
      │◄─── WS: round complete ─│                         │
      │                         │                         │
      │  [rounds N repeat]       │                         │
      │                         │                         │
      │◄─── WS: model ready ────│                         │
      │──── GET /models/download►│                         │
      │◄─── global_model.pt ────│                         │
```

---

## 3. Backend Architecture (Node.js)

### 3.1 Module Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── db.js               # MongoDB connection
│   │   ├── env.js              # Environment variables
│   │   └── constants.js        # MIN_CLIENTS, MAX_ROUNDS, etc.
│   │
│   ├── services/
│   │   ├── authService.js      # JWT creation, validation, company lookup
│   │   ├── queueService.js     # Join/leave queue, threshold checks
│   │   ├── orchestratorService.js  # Training lifecycle controller
│   │   ├── jobManager.js       # Job CRUD, status transitions
│   │   ├── modelRegistry.js    # Model artifact references, downloads
│   │   └── pythonBridge.js     # HTTP client for Python FL server
│   │
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── queue.routes.js
│   │   ├── training.routes.js
│   │   └── model.routes.js
│   │
│   ├── middleware/
│   │   ├── authMiddleware.js   # JWT verification on protected routes
│   │   ├── errorHandler.js
│   │   └── rateLimiter.js
│   │
│   ├── websocket/
│   │   ├── wsServer.js         # Socket.IO or ws setup
│   │   └── eventEmitter.js     # Internal event bus
│   │
│   ├── models/                 # Mongoose schemas (mirrors MongoDB section)
│   │   ├── Company.js
│   │   ├── TrainingJob.js
│   │   ├── Participant.js
│   │   ├── Model.js
│   │   ├── TrainingRound.js
│   │   └── WeightSnapshot.js
│   │
│   └── app.js                  # Express app bootstrap
│
├── tests/
└── Dockerfile
```

### 3.2 Service Responsibilities

**authService.js**
Validates company credentials against the MongoDB `companies` collection. Issues signed JWTs containing `{ companyId, companyName, role }`. Token expiry: 24 hours. Refresh token stored in MongoDB.

**queueService.js**
Manages the active training queue. On each `join`, it upserts a `participants` record and broadcasts the updated queue state via WebSocket to all connected browsers. Runs a polling loop (or uses MongoDB Change Streams) to detect when the participant count reaches `MIN_CLIENTS` and fires the training start event.

**orchestratorService.js**
The central state machine for a training job. Transitions through states:
`WAITING → INITIALIZING → ROUND_IN_PROGRESS → AGGREGATING → [NEXT_ROUND or FINALIZING] → COMPLETE`
It coordinates calls to `pythonBridge.js` and updates job records in MongoDB at each transition.

**jobManager.js**
CRUD operations on `TrainingJob` documents. Provides methods like `createJob()`, `updateJobStatus()`, `getActiveJob()`, `markRoundComplete()`. Used by the orchestrator to persist state durably so jobs survive server restarts.

**modelRegistry.js**
Tracks model artifacts. When the Python FL server finalizes a model, the Node server stores the artifact path, checksum, and associated job ID. Serves model files as streaming downloads, gated by participant membership check.

**pythonBridge.js**
HTTP client (using `axios`) that wraps all calls to the Python FastAPI service. Handles retries, timeouts, and error normalization. All Python communication is isolated here so the rest of the Node codebase treats it as a simple async function call.

### 3.3 WebSocket Event Catalog

| Event Name              | Direction        | Payload                                      |
|-------------------------|------------------|----------------------------------------------|
| `queue:updated`         | Server → All     | `{ participants: [], count, minRequired }`   |
| `training:starting`     | Server → All     | `{ jobId, totalRounds, startTime }`          |
| `round:started`         | Server → All     | `{ jobId, round, modelAvailable: true }`     |
| `weights:received`      | Server → All     | `{ jobId, round, received, total }`          |
| `round:complete`        | Server → All     | `{ jobId, round, metrics: { loss, acc } }`   |
| `training:complete`     | Server → Participants | `{ jobId, modelId, downloadUrl }`       |
| `participant:disconnected` | Server → All  | `{ companyId, jobId, round }`                |

---

## 4. Python ML Service

### 4.1 Architecture Choice: REST API (Option A) ✅

**Decision: Use REST API (Option A) over Message Queue (Option B)**

| Criteria                | REST API (Option A)    | Message Queue (Option B)       |
|-------------------------|------------------------|--------------------------------|
| Complexity              | Low                    | High                           |
| Latency                 | Synchronous, predictable | Async, harder to track        |
| State visibility        | Request/response clear | Requires queue monitoring      |
| Infrastructure          | No extra components    | Needs RabbitMQ/Redis           |
| Debugging               | Easy (HTTP logs)       | Complex (message tracing)      |
| Suitable for FL rounds  | Yes — sequential steps | Overkill for this use case     |

FL training rounds are inherently sequential: initialize → distribute → collect → aggregate → repeat. A synchronous REST API maps cleanly onto this. A message queue adds operational overhead without meaningful benefit at this scale.

If the system needs to support dozens of simultaneous training jobs with thousands of participants, a message queue (e.g., Redis Streams or RabbitMQ) can be introduced at that point. For now, REST is the right choice.

### 4.2 Python FL Server Structure

```
fl_server/
├── main.py                    # FastAPI app entry point
├── api/
│   ├── routes/
│   │   ├── training.py        # /fl/* endpoints
│   │   └── health.py          # /health
│   └── schemas/
│       ├── requests.py        # Pydantic request models
│       └── responses.py       # Pydantic response models
│
├── core/
│   ├── model_manager.py       # Load/save PyTorch model
│   ├── aggregator.py          # FedAvg implementation
│   ├── round_controller.py    # Round state, weight collection
│   └── weight_store.py        # Temporary in-memory weight buffer
│
├── models/
│   └── ids_model.py           # IDS neural network architecture
│
└── Dockerfile
```

### 4.3 FastAPI Endpoints (Internal — Node to Python only)

```
POST /fl/initialize
  Body: { job_id, model_version }
  Returns: { weights_b64, model_architecture, num_params }

POST /fl/distribute
  Body: { job_id, round, participant_ids[] }
  Returns: { round_model_b64, round_id }

POST /fl/receive-weights
  Body: { job_id, round, company_id, weights_b64, dataset_size }
  Returns: { received: true, waiting_for: N }

POST /fl/aggregate
  Body: { job_id, round }
  Returns: { aggregated_weights_b64, metrics: { avg_loss, delta_accuracy } }

POST /fl/finalize
  Body: { job_id }
  Returns: { model_path, checksum, size_bytes }

GET /fl/status/{job_id}
  Returns: { round, status, participants_submitted }
```

### 4.4 FedAvg Aggregation Logic

```python
# core/aggregator.py (simplified)

def federated_average(weight_updates: list[dict]) -> dict:
    """
    weight_updates: [
        { "weights": state_dict, "dataset_size": int },
        ...
    ]
    Returns: aggregated state_dict
    """
    total_samples = sum(u["dataset_size"] for u in weight_updates)
    aggregated = {}

    for key in weight_updates[0]["weights"]:
        aggregated[key] = sum(
            u["weights"][key] * (u["dataset_size"] / total_samples)
            for u in weight_updates
        )

    return aggregated
```

### 4.5 Reconnection & Weight Recovery

If a client disconnects mid-round, the Node server marks that participant as `DISCONNECTED` in MongoDB. The orchestrator has two configurable behaviors:

- **SKIP mode**: Proceed with weights already received (if >= MIN_CLIENTS submitted).
- **WAIT mode**: Hold aggregation for a configurable timeout, then skip and proceed.

This ensures training is never permanently blocked by a single disconnected company.

---

## 5. MongoDB Schema

### 5.1 Collection: `companies`

```javascript
{
  _id: ObjectId,
  companyId: String,           // "company_alpha" — unique identifier
  companyName: String,         // "Alpha Corp"
  email: String,               // login email
  passwordHash: String,        // bcrypt hash
  role: String,                // "client" (future: "admin", "observer")
  apiKey: String,              // for client training agent auth
  isActive: Boolean,           // admin can deactivate companies
  createdAt: Date,
  lastLoginAt: Date,
  metadata: {
    contactPerson: String,
    networkSegment: String      // optional, for reporting
  }
}

Indexes:
  { companyId: 1 }   unique
  { email: 1 }       unique
```

### 5.2 Collection: `training_jobs`

```javascript
{
  _id: ObjectId,
  jobId: String,               // "job_2024_001" — human-readable
  status: String,              // WAITING | INITIALIZING | ROUND_IN_PROGRESS |
                               // AGGREGATING | FINALIZING | COMPLETE | FAILED
  currentRound: Number,        // 1-based
  totalRounds: Number,         // configurable per job
  minParticipants: Number,
  participantIds: [String],    // companyIds confirmed in this job
  globalModelVersion: String,  // e.g. "v1.0.0"
  modelId: ObjectId,           // ref: models (populated on completion)
  startedAt: Date,
  completedAt: Date,
  failureReason: String,       // if status === FAILED
  config: {
    learningRate: Number,
    batchSize: Number,
    localEpochs: Number,
    aggregationStrategy: String  // "fedavg" (default)
  },
  createdAt: Date,
  updatedAt: Date
}

Indexes:
  { status: 1 }
  { createdAt: -1 }
```

### 5.3 Collection: `participants`

```javascript
{
  _id: ObjectId,
  jobId: String,               // ref: training_jobs.jobId
  companyId: String,           // ref: companies.companyId
  status: String,              // QUEUED | TRAINING | SUBMITTED | DISCONNECTED | DONE
  joinedQueueAt: Date,
  trainingStartedAt: Date,
  lastHeartbeatAt: Date,
  roundsCompleted: Number,
  currentRound: Number,
  datasetSize: Number,         // self-reported by client agent (used in FedAvg weighting)
  weightsSubmitted: [
    {
      round: Number,
      submittedAt: Date,
      snapshotId: ObjectId     // ref: weight_snapshots
    }
  ]
}

Indexes:
  { jobId: 1, companyId: 1 }   unique
  { status: 1 }
```

### 5.4 Collection: `models`

```javascript
{
  _id: ObjectId,
  modelId: String,             // "model_job_2024_001_final"
  jobId: String,               // ref: training_jobs.jobId
  version: String,             // semantic version "1.0.0"
  status: String,              // PENDING | AVAILABLE | ARCHIVED
  artifactPath: String,        // "/models/global_model_job001.pt"
  checksum: String,            // SHA-256 of the .pt file
  sizeBytes: Number,
  architecture: String,        // "IDSNet_v2"
  trainingMetrics: {
    finalLoss: Number,
    finalAccuracy: Number,
    roundsCompleted: Number,
    totalParticipants: Number
  },
  createdAt: Date,
  availableUntil: Date         // optional expiry for cleanup
}

Indexes:
  { jobId: 1 }
  { status: 1 }
```

### 5.5 Collection: `training_rounds`

```javascript
{
  _id: ObjectId,
  jobId: String,
  roundNumber: Number,
  status: String,              // IN_PROGRESS | AGGREGATING | COMPLETE | FAILED
  participantsExpected: [String],   // companyIds
  participantsSubmitted: [String],  // companyIds that submitted
  aggregationMetrics: {
    avgLoss: Number,
    accuracyDelta: Number,
    aggregationStrategy: String
  },
  startedAt: Date,
  aggregatedAt: Date,
  completedAt: Date
}

Indexes:
  { jobId: 1, roundNumber: 1 }   unique
```

### 5.6 Collection: `weight_snapshots`

```javascript
{
  _id: ObjectId,
  jobId: String,
  roundNumber: Number,
  companyId: String,
  storagePath: String,         // path to encrypted weights file on volume
  encryptionKeyRef: String,    // reference to key in secrets manager
  datasetSize: Number,
  submittedAt: Date,
  isAggregated: Boolean,       // true after FedAvg consumes this snapshot
  deletedAt: Date              // weights are deleted after aggregation (privacy)
}

Indexes:
  { jobId: 1, roundNumber: 1, companyId: 1 }   unique
```

> **Privacy Note:** Weight snapshots are deleted from disk after aggregation is complete. Only the aggregated global weights persist. The `weight_snapshots` collection retains only metadata (no raw weights in DB).

---

## 6. API Endpoints

### 6.1 Authentication

```
POST /auth/login
  Body:    { email: string, password: string }
  Returns: { token: string, company: { id, name, role } }
  Errors:  401 Invalid credentials | 403 Account inactive

POST /auth/logout
  Headers: Authorization: Bearer <token>
  Returns: { success: true }

GET /auth/me
  Headers: Authorization: Bearer <token>
  Returns: { company: { id, name, role, lastLoginAt } }
```

### 6.2 Queue Management

```
GET /queue
  Headers: Authorization: Bearer <token>
  Returns: {
    participants: [{ companyId, companyName, joinedAt }],
    count: number,
    minRequired: number,
    readyToStart: boolean,
    activeJob: { jobId, status } | null
  }

POST /queue/join
  Headers: Authorization: Bearer <token>
  Returns: { joined: true, position: number, queueState: {...} }
  Errors:  409 Already in queue | 409 Training already in progress

POST /queue/leave
  Headers: Authorization: Bearer <token>
  Returns: { left: true }
  Errors:  400 Cannot leave during active training round
```

### 6.3 Training

```
GET /training/status
  Headers: Authorization: Bearer <token>
  Query:   ?jobId=<jobId>
  Returns: {
    jobId, status, currentRound, totalRounds,
    participants: [{ companyId, status, roundsCompleted }],
    metrics: { latestLoss, latestAccuracy }
  }

GET /training/model
  Headers: Authorization: Bearer <token>
  Query:   ?jobId=<jobId>&round=<round>
  Returns: { weightsB64: string, modelVersion: string, round: number }
  Errors:  403 Not a participant | 404 Round not started

POST /training/submit-weights
  Headers: Authorization: Bearer <token>
  Body:    { jobId: string, round: number, weightsB64: string, datasetSize: number }
  Returns: { submitted: true, waitingFor: number }
  Errors:  400 Wrong round | 409 Already submitted for this round | 403 Not a participant

GET /training/history
  Headers: Authorization: Bearer <token>
  Returns: [ { jobId, completedAt, rounds, participants, modelId } ]
```

### 6.4 Models

```
GET /models
  Headers: Authorization: Bearer <token>
  Returns: [ { modelId, jobId, version, status, createdAt, metrics } ]

GET /models/:modelId
  Headers: Authorization: Bearer <token>
  Returns: { modelId, jobId, version, status, metrics, checksum, sizeBytes }

GET /models/:modelId/download
  Headers: Authorization: Bearer <token>
  Returns: Binary stream (application/octet-stream) — global_model.pt
  Errors:  403 Not a participant of this job | 404 Model not found | 409 Model not ready
```

### 6.5 Health

```
GET /health
  Returns: { status: "ok", db: "connected", pythonService: "reachable" }
```

---

## 7. Frontend Pages

### 7.1 Page 1 — Login Page (`/login`)

**Purpose:** Company authentication entry point.

**Components:**
- Company logo / platform title: "FL-IDS Platform"
- Email and password fields
- "Sign In" button
- Error message display (invalid credentials, inactive account)

**Behavior:**
- On success: stores JWT in `httpOnly` cookie or `localStorage`, redirects to `/queue`
- Shows loading spinner during auth request
- Field-level validation before submission

**Data Flow:** `POST /auth/login` → receive JWT → redirect

---

### 7.2 Page 2 — Training Queue Dashboard (`/queue`)

**Purpose:** Shows all companies waiting for training and the current queue state. This is the pre-training waiting room.

**Components:**
- **Queue Panel** (left): Live list of joined companies, each showing name and join time
- **Status Banner**: "Waiting for X more companies to join" or "Training starting in…"
- **Join / Leave Button**: Toggle queue participation
- **Configuration Summary**: Total rounds, min participants, model version
- **Real-time participant counter**: e.g. "3 / 5 companies joined"

**Behavior:**
- WebSocket subscription to `queue:updated` events — list updates without page refresh
- When `readyToStart` becomes true, banner transitions to countdown or redirect
- When `training:starting` event received, auto-navigate to `/training`

**Data Flow:** `GET /queue` (initial load) + WebSocket `queue:updated` stream

---

### 7.3 Page 3 — Training Status Page (`/training`)

**Purpose:** Real-time view of an active training job. Companies monitor round progress here.

**Components:**
- **Progress Bar**: Round N of M (e.g. Round 2 of 5)
- **Current Round Status**: DISTRIBUTING MODEL → LOCAL TRAINING → COLLECTING WEIGHTS → AGGREGATING → ROUND COMPLETE
- **Participant Status Table**: Each company row showing status (Training / Submitted / Waiting)
- **Metrics Chart**: Live loss curve and accuracy delta per round (line chart)
- **Event Log**: Timestamped feed of events (e.g. "Company Beta submitted weights — Round 2")
- **Estimated Time Remaining**

**Behavior:**
- Subscribes to: `round:started`, `weights:received`, `round:complete`, `training:complete`
- When `training:complete` received: show "Training Complete" banner and navigate to `/models`
- If participant disconnects: show warning in participant table row

**Data Flow:** `GET /training/status` (initial) + WebSocket event stream

---

### 7.4 Page 4 — Model Download Page (`/models`)

**Purpose:** Post-training page where each participant downloads the trained global model.

**Components:**
- **Model Card**: Job ID, version, completion date, total rounds, participants
- **Performance Summary**: Final loss, final accuracy, rounds completed
- **Download Button**: "Download trained_model.pt" → triggers authenticated file download
- **Checksum Display**: SHA-256 hash for integrity verification
- **Training History Table**: Previous jobs with download links
- **Usage Guide**: Brief instructions on deploying the model for local inference

**Behavior:**
- `GET /models/:modelId` → fetch model metadata
- `GET /models/:modelId/download` → streams `.pt` file download
- Download button disabled until model status is `AVAILABLE`
- Participation gating: only companies that were participants of a job can download its model

**Data Flow:** `GET /models` (list) + `GET /models/:id/download` (download)

---

## 8. Training Queue Logic

### 8.1 Queue State Machine

```
Company calls POST /queue/join
        │
        ▼
┌───────────────────┐
│  PARTICIPANT      │  ← stored in MongoDB participants collection
│  status: QUEUED   │
└───────────┬───────┘
            │
            ▼
   Queue Service polls every 10 seconds
   (or uses MongoDB Change Stream for real-time)
            │
            ├── count < MIN_CLIENTS ──► Broadcast: "Waiting for N more"
            │
            └── count >= MIN_CLIENTS
                        │
                        ▼
               Lock the queue (set flag in Redis or MongoDB)
               Snapshot participant list
               Create TrainingJob document
               Broadcast training:starting event
               Trigger Orchestrator
```

### 8.2 Queue Algorithm

```javascript
// queueService.js — simplified

const MIN_CLIENTS = process.env.MIN_CLIENTS || 3;
const QUEUE_CHECK_INTERVAL_MS = 10_000;

async function checkQueueThreshold() {
  const queuedCount = await Participant.countDocuments({
    status: 'QUEUED',
    jobId: null
  });

  if (queuedCount >= MIN_CLIENTS) {
    const isLocked = await acquireQueueLock(); // atomic Redis SET NX
    if (!isLocked) return; // another instance already handling this

    const participants = await Participant.find({
      status: 'QUEUED', jobId: null
    }).limit(MIN_CLIENTS);

    const job = await TrainingJob.create({
      status: 'INITIALIZING',
      participantIds: participants.map(p => p.companyId),
      totalRounds: DEFAULT_ROUNDS,
      minParticipants: MIN_CLIENTS
    });

    await Participant.updateMany(
      { _id: { $in: participants.map(p => p._id) } },
      { $set: { jobId: job.jobId, status: 'TRAINING' } }
    );

    eventEmitter.emit('training:start', { job });
    broadcastToAll('training:starting', { jobId: job.jobId });
    releaseQueueLock();
  }
}

setInterval(checkQueueThreshold, QUEUE_CHECK_INTERVAL_MS);
```

### 8.3 Minimum Client Enforcement

- `MIN_CLIENTS` is configurable via environment variable (default: 3)
- Queue is locked atomically when threshold is met to prevent race conditions in multi-instance deployments
- Companies that join after the lock is taken are queued for the **next** training job
- If a company disconnects while `QUEUED` (before training starts), they are removed from the queue and the count is re-evaluated

---

## 9. Federated Training Orchestration

### 9.1 Orchestrator State Machine

```
                    ┌─────────────────┐
                    │   INITIALIZING  │
                    │  POST /fl/init  │
                    └────────┬────────┘
                             │ global model created
                             ▼
                    ┌─────────────────┐
             ┌─────►│ DISTRIBUTING    │
             │      │ send model to   │
             │      │ all clients     │
             │      └────────┬────────┘
             │               │ all clients have model
             │               ▼
             │      ┌─────────────────┐
             │      │ ROUND_IN_PROGRESS│
             │      │ clients training │
             │      │ locally         │
             │      └────────┬────────┘
             │               │ all weights received
             │               ▼
             │      ┌─────────────────┐
             │      │  AGGREGATING    │
             │      │ POST /fl/aggregate│
             │      └────────┬────────┘
             │               │ aggregation done
             │               ▼
             │      ┌─────────────────┐
             │      │ ROUND_COMPLETE   │
             │      │ metrics stored  │
             └──────┤ round < total?  │
    next round      └────────┬────────┘
                             │ round == total
                             ▼
                    ┌─────────────────┐
                    │   FINALIZING    │
                    │ POST /fl/finalize│
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    COMPLETE     │
                    │ model available │
                    └─────────────────┘
```
## 9.2 Weight Aggregation Strategy (Secure Masked Meta-Aggregation)

Instead of using the traditional **FedAvg weighted average**, this system adopts a **Secure Masked Meta-Aggregation** strategy. In this approach, each participating company first computes its local model update after training and then applies a privacy mask before sending the update to the server. The masks are constructed so they cancel out during aggregation, ensuring the server cannot inspect any individual client update.

After the masks cancel, the server uses a lightweight **meta-aggregator** to combine participant updates. Unlike standard averaging, the meta-aggregator can learn better ways to combine updates from heterogeneous clients with different data distributions.

This improves both **privacy protection** and **model performance**, especially in environments where companies have different network traffic patterns and non-IID datasets.

### Aggregation Formulation

Masked\_Update_k = \Delta_k + M_k

### 9.3 Round Timeout & Recovery

Each round has a configurable timeout (`ROUND_TIMEOUT_MINUTES`, default: 30). If not all expected participants submit weights within the timeout:

1. Node marks non-responsive participants as `DISCONNECTED`
2. If remaining submitters >= `MIN_CLIENTS`, aggregation proceeds with available weights
3. If remaining submitters < `MIN_CLIENTS`, the job transitions to `FAILED` with reason `INSUFFICIENT_PARTICIPANTS`
4. All connected participants are notified via WebSocket

### 9.4 Global Model Distribution

The Node server does not store model weights in MongoDB. Binary weights are:
- Held in the Python FL server's in-memory state during training
- Retrieved by the Node server on demand via `GET /fl/distribute`
- Delivered to each company's browser via `GET /training/model`
- Deleted from the Python server's memory after each round is complete
- Persisted only as the final `global_model.pt` artifact on a shared Docker volume

---

## 10. Deployment Architecture

### 10.1 Container Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Docker Compose / Kubernetes                  │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐                       │
│  │  frontend        │    │  node-backend    │                       │
│  │  nginx:alpine    │    │  node:20-alpine  │                       │
│  │  Port: 3000      │◄───│  Port: 4000      │                       │
│  │  React SPA       │    │  Express + WS    │                       │
│  └──────────────────┘    └────────┬─────────┘                       │
│                                   │                                 │
│          ┌────────────────────────┼────────────────────┐            │
│          │                        │                    │            │
│          ▼                        ▼                    ▼            │
│  ┌───────────────┐   ┌────────────────────┐  ┌───────────────────┐ │
│  │  mongodb      │   │  python-fl-server  │  │  model-store      │ │
│  │  mongo:7      │   │  python:3.11-slim  │  │  (shared volume)  │ │
│  │  Port: 27017  │   │  Port: 8000        │  │  /models/*.pt     │ │
│  │  Persistent   │   │  FastAPI + PyTorch │  └───────────────────┘ │
│  │  Volume       │   │  Internal only     │           ▲            │
│  └───────────────┘   └────────────────────┘           │            │
│                               │                        │            │
│                               └────────────────────────┘            │
│                          (python writes .pt to shared volume;       │
│                           node streams it to browsers)              │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2 Docker Compose Configuration

```yaml
# docker-compose.yml

version: "3.9"

services:

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - node-backend
    environment:
      - VITE_API_URL=http://node-backend:4000
      - VITE_WS_URL=ws://node-backend:4000

  node-backend:
    build: ./backend
    ports:
      - "4000:4000"
    depends_on:
      - mongodb
      - python-fl-server
    environment:
      - MONGODB_URI=mongodb://mongodb:27017/fl_ids
      - PYTHON_FL_URL=http://python-fl-server:8000
      - JWT_SECRET=${JWT_SECRET}
      - MIN_CLIENTS=3
      - DEFAULT_ROUNDS=5
    volumes:
      - model-store:/app/models

  python-fl-server:
    build: ./fl_server
    ports:
      - "8000:8000"   # internal only — not exposed externally
    environment:
      - MODEL_STORE_PATH=/models
    volumes:
      - model-store:/models
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]   # optional GPU support

  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    environment:
      - MONGO_INITDB_DATABASE=fl_ids

volumes:
  mongo-data:
    driver: local
  model-store:
    driver: local
```

### 10.3 Network Security

- The Python FL server is on an internal Docker network only. It is NOT exposed on a public port.
- All external traffic enters via the Node backend (port 4000) or the frontend nginx (port 3000).
- In production, place an Nginx reverse proxy or cloud load balancer in front of both, enforcing TLS.
- JWT authentication is required on every API route except `/auth/login` and `/health`.
- Model weights transmitted between the browser and Node are sent over HTTPS only.

### 10.4 Production Hardening Checklist

| Area               | Action                                                                 |
|--------------------|------------------------------------------------------------------------|
| TLS                | Terminate SSL at load balancer or nginx; all internal traffic on HTTPS |
| Secrets            | Use Docker secrets or a vault (e.g., HashiCorp Vault) for JWT_SECRET  |
| MongoDB Auth       | Enable MongoDB authentication; use dedicated user per service          |
| Rate Limiting      | Apply rate limiter middleware on `/auth/login` (brute-force protection)|
| Weight Encryption  | Encrypt weight payloads in transit (TLS) and at rest on volume         |
| Logging            | Structured JSON logs; ship to ELK or Datadog                          |
| Health Checks      | Docker `HEALTHCHECK` on all containers                                 |
| Backups            | Daily MongoDB dump; snapshot Docker volume for model store             |

---

## 11. Development Roadmap

### Phase 1 — Foundation (Weeks 1–3)

- [ ] Set up Docker Compose with all four containers
- [ ] Implement MongoDB schemas and Mongoose models
- [ ] Build `POST /auth/login` with JWT issuance
- [ ] Seed database with initial company records
- [ ] Build React login page
- [ ] Basic health endpoint on Node and Python services

### Phase 2 — Queue System (Weeks 4–5)

- [ ] Implement queue service (join, leave, threshold detection)
- [ ] WebSocket server setup (Socket.IO)
- [ ] `queue:updated` events broadcast to all clients
- [ ] React queue dashboard with real-time participant list
- [ ] Auto-trigger training job creation on threshold

### Phase 3 — FL Core Integration (Weeks 6–8)

- [ ] Python FastAPI endpoints: `/fl/initialize`, `/fl/distribute`, `/fl/aggregate`, `/fl/finalize`
- [ ] `pythonBridge.js` in Node
- [ ] Full orchestrator state machine
- [ ] Round management and weight submission endpoint
- [ ] Training round tracking in MongoDB

### Phase 4 — Frontend Training UI (Weeks 9–10)

- [ ] Training status page with round progress and metrics chart
- [ ] Participant status table with real-time updates
- [ ] WebSocket events wired to UI state
- [ ] Disconnection handling and warnings

### Phase 5 — Model Download & Registry (Week 11)

- [ ] Model registry service
- [ ] Model artifact streaming download
- [ ] Model download page in React
- [ ] Participation gating on download

### Phase 6 — Hardening & Production (Weeks 12–14)

- [ ] TLS configuration
- [ ] Weight encryption at rest
- [ ] Rate limiting and input validation
- [ ] Job failure and recovery testing
- [ ] Load testing with simulated multi-company scenarios
- [ ] Structured logging and monitoring dashboards
- [ ] End-to-end integration tests

---

## Appendix: Key Design Decisions Summary

| Decision                               | Choice                        | Rationale                                              |
|----------------------------------------|-------------------------------|--------------------------------------------------------|
| Node ↔ Python communication            | REST API                      | Sequential FL rounds map cleanly; avoids queue overhead|
| WebSocket library                      | Socket.IO                     | Rooms, namespaces, auto-reconnect built-in             |
| JWT storage                            | httpOnly cookie               | Prevents XSS-based token theft                         |
| Weight storage                         | Encrypted filesystem volume   | Keeps raw weights out of MongoDB; deleted post-aggregation |
| Queue trigger mechanism                | Polling + atomic lock         | Simple, reliable, prevents double-start                |
| Aggregation algorithm                  | FedAvg (weighted by data size)| Industry standard for FL; aligns with research prototype|
| Model artifact delivery                | Shared Docker volume          | Python writes once; Node streams to multiple browsers  |
| Python service visibility              | Internal network only         | Attack surface reduction; Node is the only gateway     |

---

*Document version 1.0 — FL-IDS Web Platform Architecture*
