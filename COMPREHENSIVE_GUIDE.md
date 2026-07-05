# RAKKU: Comprehensive Developer & Onboarding Guide

Welcome to the **RAKKU (Responsive Assistant for Knowledge, Kiosk & Citizen Utilities)** developer onboarding guide. This document provides an in-depth architectural breakdown, database models, API workflows, and system sequences to help you understand and contribute to the platform.

---

## 1. System Architecture Diagram

```mermaid
graph TD
    %% Frontend Layer
    subgraph Frontend [Next.js App Router]
        ChatUI[Citizen Chat Interface]
        AdminUI[Admin Command Center]
        ThemeToggle[Theme Manager]
        SocketClient[useEmergencySocket]
    end

    %% Backend Gateway Layer
    subgraph Gateway [NestJS Gateway]
        AuthGuard[Rate Limiter & Fingerprinter]
        Router[Jurisdiction Router]
        EmergencySVC[Emergency Service]
        DashboardNotifier[Socket.IO Gateway]
    end

    %% AI Layer
    subgraph AI [FastAPI AI Engine]
        WorkflowEngine[State Machine & Slot Filler]
        RAGEngine[Vector RAG Search]
        Gemini[Google Gemini 2.5 API]
        KB[(knowledge_base.json)]
    end

    %% Database Layer
    subgraph Database [PostgreSQL via Prisma]
        DB_Citizen[(Citizen Records)]
        DB_Services[(Service Applications)]
        DB_Emergency[(SOS Alerts)]
    end

    %% Connections
    ChatUI -->|HTTP POST /api/chat| AuthGuard
    AuthGuard -->|Proxy Request| WorkflowEngine
    WorkflowEngine <--> RAGEngine
    RAGEngine <--> KB
    WorkflowEngine <--> Gemini
    
    %% SOS Flow
    ChatUI -->|HTTP POST /api/emergency/trigger| EmergencySVC
    EmergencySVC -->|Write| DB_Emergency
    EmergencySVC --> DashboardNotifier
    DashboardNotifier -.->|new_alert, alert_updated| SocketClient
    SocketClient --> AdminUI
    
    %% DB Reads
    AuthGuard -->|Read/Write| DB_Citizen
    AuthGuard -->|Read/Write| DB_Services
```

### 1.1 Architectural Layers Breakdown

RAKKU follows a strict multi-tiered architecture separating concerns into distinct logical layers:

```mermaid
block-beta
  columns 1
  
  block:Presentation["1. Presentation Layer (Next.js)"]
    Chat["Citizen Chat UI"]
    Admin["Admin Command Center"]
  end

  space

  block:Gateway["2. API Gateway & Routing (NestJS)"]
    Auth["Security & Fingerprint"]
    Router["Jurisdiction Router"]
    Socket["Emergency WebSockets"]
  end

  space

  block:AI["3. AI & Business Logic (FastAPI)"]
    Workflow["State Machine (Slot Filling)"]
    RAG["Vector Search (Knowledge Base)"]
  end

  space

  block:Data["4. Data Access & Persistence (Prisma & Postgres)"]
    DB["Relational Data Integrity"]
  end

  Presentation -- "HTTP / WSS" --> Gateway
  Gateway -- "Internal Proxy" --> AI
  Gateway -- "Prisma ORM" --> Data
```

#### 1. Presentation Layer (Frontend / Next.js)
- **Responsibility:** User interaction, accessibility, animation, and real-time state management.
- **Key Patterns:** Client-side rendering for interactivity (chat interface, map routing) and Server-Side Rendering (SSR) for initial load performance.
- **Core Modules:**
  - `ChatUI`: The primary conversational interface.
  - `Admin Dashboard`: Secure portal for police dispatchers to monitor SOS signals and view intelligence analytics.
  - `ThemeManager`: Manages Light/Dark modes seamlessly across the UI.

#### 2. API Gateway & Routing Layer (Backend / NestJS)
- **Responsibility:** Secure proxying, payload validation, database interactions, and real-time event broadcasting.
- **Key Patterns:** Decorator-based route handling, Dependency Injection, and Middleware.
- **Core Modules:**
  - `AuthGuard & Security`: Validates JWTs, enforces rate limiting, and manages deterministic fingerprinting to prevent spam.
  - `JurisdictionRouter`: Intelligently routes verified complaints to the correct out of 75 UP districts.
  - `EmergencyGateway`: Maintains WebSocket connections to instantly broadcast `new_alert` events.

#### 3. AI & Business Logic Layer (FastAPI)
- **Responsibility:** Intent classification, slot-filling, semantic search, and generative response formulation.
- **Key Patterns:** Stateless request handling, State Machine execution, and Vector embeddings.
- **Core Modules:**
  - `WorkflowEngine`: A robust state machine that identifies missing information (e.g., IMEI number) and prompts the user until a workflow is complete.
  - `RAGEngine (Retrieval-Augmented Generation)`: Queries `knowledge_base.json` to ground LLM responses in factual policy data.
  - `Gemini Integration`: Interfaces with Google Gemini 2.5 Flash for natural language understanding and generation.

#### 4. Data Access & Persistence Layer (Prisma & PostgreSQL)
- **Responsibility:** Long-term storage, relational data integrity, and complex queries.
- **Key Patterns:** Object-Relational Mapping (ORM) and strongly-typed queries.
- **Core Modules:**
  - `Prisma Client`: Used by NestJS to perform CRUD operations on `Citizen`, `Complaint`, and `EmergencyAlert` tables.
  - `Database Trigger/Events`: Handles timestamps, cascades, and status enum constraints.

---

## 2. Database Entity-Relationship (ER) Diagram

RAKKU uses Prisma ORM connected to a PostgreSQL/Supabase database. Below is the simplified ER diagram of the core models.

```mermaid
erDiagram
    Citizen {
        String id PK
        String fullName
        String mobileNumber
        String district
        Float latitude
        Float longitude
        Boolean isConfirmed
    }

    Complaint {
        String id PK
        String referenceNumber UK
        String citizenId FK
        String complaintType
        String status
        String jurisdictionResolutionId FK
    }

    CharacterCertificate {
        String id PK
        String referenceNumber UK
        String citizenId FK
        String status
        Boolean usedProfileReuse
        Json profileSnapshot
    }

    EventPermission {
        String id PK
        String referenceNumber UK
        String citizenId FK
        String eventType
        String status
    }

    EmergencyAlert {
        String id PK
        String referenceNumber UK
        String citizenId FK
        String status
        Float latitude
        Float longitude
        Boolean adminAcknowledged
    }

    JurisdictionResolution {
        String id PK
        String district
        String targetStation
        String routingPolicy
    }

    Citizen ||--o{ Complaint : "files"
    Citizen ||--o{ CharacterCertificate : "requests"
    Citizen ||--o{ EventPermission : "organizes"
    Citizen ||--o{ EmergencyAlert : "triggers"
    
    JurisdictionResolution ||--o{ Complaint : "routes"
    JurisdictionResolution ||--o{ CharacterCertificate : "routes"
```

---

## 3. Core Workflows (Sequence Diagrams)

### 3.1 The Standard Chat & Service Request Flow

When a citizen converses with Inspector Rakku to file a complaint, the system utilizes a slot-filling AI state machine.

```mermaid
sequenceDiagram
    participant Citizen
    participant NextJS as Frontend (Next.js)
    participant NestJS as API Gateway (NestJS)
    participant FastAPI as AI Engine (FastAPI)
    participant Gemini as Google Gemini
    participant DB as PostgreSQL

    Citizen->>NextJS: "I lost my mobile phone in Lucknow."
    NextJS->>NestJS: POST /api/chat { message, coords }
    
    %% Security Layer
    NestJS->>NestJS: Check Rate Limits (60 req/min)
    NestJS->>NestJS: Validate Fingerprint Payload
    
    NestJS->>FastAPI: Proxy { message, state }
    
    %% AI State Machine
    FastAPI->>FastAPI: Analyze Intent (COMPLAINT)
    FastAPI->>Gemini: Extract entities (Lost Mobile, Lucknow)
    Gemini-->>FastAPI: Missing slots: [mobileBrand, imeiNumber]
    
    FastAPI-->>NestJS: Respond with follow-up prompt
    NestJS-->>NextJS: Display "Can you provide the IMEI?"
    
    %% Finalization
    Citizen->>NextJS: "IMEI is 123456789"
    NextJS->>NestJS: POST /api/chat
    NestJS->>FastAPI: Proxy { message, state }
    FastAPI->>Gemini: Validate completion
    Gemini-->>FastAPI: All slots filled. Execute intent.
    
    FastAPI-->>NestJS: Action Trigger: CREATE_COMPLAINT
    NestJS->>DB: INSERT into Complaint
    NestJS->>DB: INSERT into JurisdictionResolution
    NestJS-->>NextJS: Render Success StatusBadge & ApplicationCard
```

### 3.2 Real-Time Emergency (SOS) Flow

RAKKU features a real-time Command Center for dispatchers, built entirely on WebSockets.

```mermaid
sequenceDiagram
    participant Citizen
    participant NextJS as Citizen UI
    participant NestJS as EmergencyService
    participant Socket as Socket.IO (Gateway)
    participant AdminUI as Admin Dashboard
    participant DB as Database

    Citizen->>NextJS: Clicks SOS Button
    NextJS->>NestJS: POST /api/emergency/trigger { lat, lng }
    NestJS->>DB: CREATE EmergencyAlert (status: ACTIVE)
    
    %% Socket Broadcast
    NestJS->>Socket: broadcastNewAlert(alert)
    Socket-->>AdminUI: Emit 'new_alert'
    
    %% Admin Reaction
    AdminUI->>AdminUI: Flash Red, Play Siren Sound
    AdminUI->>AdminUI: Update Notification Bell Badge Count
    
    %% Acknowledgment
    AdminUI->>NestJS: POST /api/emergency/:id/acknowledge
    NestJS->>DB: UPDATE alert (status: ACKNOWLEDGED, adminAcknowledged: true)
    NestJS->>Socket: broadcastAlertUpdate(alert)
    Socket-->>AdminUI: Emit 'alert_updated'
    
    %% Resolution
    AdminUI->>AdminUI: Pause Siren Sound
    AdminUI->>AdminUI: Change Feed Badge to Yellow (Ack)
```

---

## 4. Advanced System Features

### 4.1 Profile Reuse Protocol (PRP)
The Profile Reuse Protocol (`handleProfileReuseProtocol`) minimizes friction for returning citizens. 
1. **Lookup**: When a verified citizen starts a flow (like an Event Permission), the system retrieves their `Citizen` record.
2. **Mapping**: The frontend automatically pre-fills fields (e.g., Organizer Name, Address) based on the profile.
3. **Snapshot Isolation**: The database takes a `profileSnapshot` (JSON) of the citizen at the time of submission, isolating the record from future profile updates.
4. **Accessibility**: Screen readers utilize `Announcements.announce` to voice out: "Form pre-filled using your verified profile."

### 4.2 Admin Intelligence Hub
Located at `/admin`, this is a fully responsive React Component (`AdminIntelligenceView.tsx`) that:
- Reads nightly aggregated DB queries (Sentiments, Workflows).
- Embeds charts and dynamic metrics.
- Seamlessly respects the user's `dark:` Tailwind preferences.
- Exists in the same layout as the live `EmergencyAlertsWidget.tsx`, guaranteeing admins never miss an SOS while reading analytics.

### 4.3 Multi-Tier Security & Abuse Protection
1. **Rate Limiting**: `express-rate-limit` enforces 60 requests/minute globally, and stricter 15 requests/minute for heavy AI inference routes.
2. **Payload Protection**: Express JSON limiters cap payloads at 1MB to prevent DOS attacks.
3. **Fingerprinting**: Every database mutation (like filing a complaint) hashes the request body and user IP to generate a SHA256 deterministic hash. NestJS throws a `409 Conflict` if the same hash is submitted within a 5-minute window.

---

## 5. Setup & Execution

### Option A: Docker Compose (Recommended)
This spins up the Database, Frontend, NestJS Backend, and FastAPI AI layer simultaneously.
```bash
docker compose up --build
```

### Option B: Local Microservices
If you need to debug specific layers:

**1. Database & Backend (NestJS)**
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run start:dev
```

**2. Frontend (Next.js)**
```bash
cd frontend
npm install
npm run dev
```

**3. AI Engine (FastAPI)**
```bash
cd ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

---

## 6. Testing (Master Test Framework)

RAKKU enforces a rigorous **Master Test Framework (MTF)** to guarantee system reliability. Tests span unit, integration, and parity checks.

To execute the entire MTF:
```bash
# Windows (PowerShell)
.\run_all_tests.ps1

# Linux/Mac
./scripts/run_all_tests.sh
```

**Parity Guarantee:**
RAKKU strictly tests language parity. For example, the intent for triggering an emergency MUST correctly fire whether the user types:
- "I need help" (English)
- "मुझे मदद चाहिए" (Hindi)
- "Emergency hai" (Hinglish)

*End of Guide*
