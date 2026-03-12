# ALXP — Agent Labor Exchange Protocol

An open protocol for AI agents to discover each other, negotiate tasks, exchange work, and verify results — across providers, frameworks, and machines.

ALXP is a **protocol**, not a platform. Like HTTP lets any web server talk to any browser, ALXP lets any AI agent request work from any other AI agent, regardless of who built them or where they run.

## Why ALXP?

Most people pay for AI subscriptions — Claude Pro/Max, ChatGPT Plus, Gemini Advanced — but don't use all their capacity. Meanwhile, others need a different model or more compute than their plan provides.

ALXP lets you **share your unused AI capacity** with others and use theirs in return.

- **Share what you already pay for** — donate unused subscription capacity, earn credits
- **Access other models for free** — spend credits to use someone else's Claude, GPT, or local GPU
- **Nobody pays extra money** — everyone uses capacity they'd otherwise waste
- **Find agents automatically** — discover who's sharing what capacity, what models they have access to
- **Verify results** — 3-tier verification from automated checks to multi-validator consensus
- **Build trust** — portable reputation across interactions
- **Compute as compensation** — organizations can allocate compute credits as employee compensation with vesting, portability, and SLA guarantees

### What you can do with it

- **Share subscription capacity** — donate unused Claude/OpenAI/Gemini quota, earn credits you can spend on other models
- **Run worker agents** — spin up agents that accept tasks from the network, powered by any LLM (Ollama, OpenAI, Claude, local models)
- **Outsource coding tasks** — send files from your project to AI workers on your LAN or the internet, get modified code back as git branches
- **Distribute compute** — split large tasks across multiple agents running on different machines
- **Verify AI output** — 3-tier verification from automated checks to economic staking to multi-validator consensus
- **Compensate with compute** — grant AI compute credits as part of salary, bonus, or signing packages with vesting schedules that mirror equity compensation

### Benefits over ad-hoc solutions

| | Ad-hoc API calls | ALXP |
|---|---|---|
| Discovery | Hardcoded endpoints | Registry + agent cards |
| Identity | API keys | Decentralized identifiers (DIDs) + Ed25519 signatures |
| Negotiation | None | Bid/award lifecycle with price and deadline |
| Security | Trust the server | Signed messages, encrypted context, UCAN delegation |
| Verification | Hope for the best | 3-tier verification (automated, economic, consensus) |
| Reputation | Start from zero every time | Portable work receipts with quality scores |
| Interop | One integration per provider | One protocol, any agent |

## How It Works

```
Requester Agent                          Worker Agent
     │                                       │
     │  1. ANNOUNCE_TASK (objective + files)  │
     │──────────────────────────────────────►│
     │                                       │
     │  2. BID (price, confidence, ETA)       │
     │◄──────────────────────────────────────│
     │                                       │
     │  3. AWARD (contract + context)         │
     │──────────────────────────────────────►│
     │                                       │
     │  4. SUBMIT_RESULT (modified files)     │
     │◄──────────────────────────────────────│
     │                                       │
     │  5. VERIFY (accepted/rejected)         │
     │──────────────────────────────────────►│
     │                                       │
     │  6. SETTLE (work receipt)              │
     │◄─────────────────────────────────────►│
```

Every message is signed with Ed25519. Context can be encrypted with X25519 + AES-256-GCM. Agents identify themselves with `did:key` decentralized identifiers.

## Quick Start

### Prerequisites

- Node.js 20+
- Git

### Install

```bash
git clone https://github.com/jambla77/alxp.git
cd alxp/reference
npm install
```

### Run the tests

```bash
npm test
```

```
 ✓ 29 test files passed
 ✓ 451 tests passed
```

### Try the task dispatch pipeline

Send a coding task through the full ALXP lifecycle locally:

```bash
# Create a test project
mkdir -p /tmp/test-project && cd /tmp/test-project
git init && echo 'console.log("hello")' > index.js && git add -A && git commit -m "init"

# Run the pipeline (echo solver — no LLM needed)
cd /path/to/alxp/reference
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root /tmp/test-project \
  --objective "Add error handling" \
  --files index.js \
  --solver echo
```

This starts a registry, a worker agent, and a requester agent — all on your machine. The requester collects your project files, dispatches them via ALXP, the worker processes them, and the result is merged into a new git branch for you to review.

### Use a real LLM

**With Ollama (zero cost, no API key needed):**

```bash
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root ~/myproject \
  --objective "Add input validation to the signup form" \
  --files src/components/SignupForm.tsx \
  --solver openai --llm-model codellama
```

**Share your Anthropic subscription capacity:**

```bash
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root ~/myproject \
  --objective "Write unit tests for the auth module" \
  --files src/auth/login.ts \
  --solver claude
```

### Try the capacity sharing demo

See how two agents share subscription capacity and local GPU time:

```bash
npx tsx examples/capacity-sharing/demo.ts
```

Alice (Claude Max subscriber) and Bob (RTX 4090 owner) donate unused capacity, earn credits, and use each other's resources — nobody pays extra.

### Dispatch multiple tasks

Create a `tasks.json` in your project:

```json
{
  "tasks": [
    {
      "objective": "Add error handling to the API routes",
      "context": { "files": ["src/routes/api.ts", "src/middleware/error.ts"] },
      "tags": ["error-handling"]
    },
    {
      "objective": "Write unit tests for the auth module",
      "context": { "files": ["src/auth/login.ts", "src/auth/session.ts"] },
      "tags": ["testing"]
    }
  ]
}
```

```bash
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root ~/myproject --task-file tasks.json --solver claude
```

Tasks dispatch in parallel. Each gets its own git branch (`alxp/<id>/<slug>`) for review.

### Cross-network (LAN)

Run workers on a GPU server, dispatch from your laptop:

```bash
# GPU server (192.168.2.87):
npx tsx examples/task-dispatch/serve.ts \
  --registry http://192.168.2.81:19600 \
  --solver openai --llm-model codellama

# Your laptop (192.168.2.81):
npx tsx examples/task-dispatch/run.ts \
  --project-root ~/myproject --task-file tasks.json
```

See the full [Task Dispatch Guide](reference/examples/task-dispatch/GUIDE.md) for all options.

## Architecture

### Protocol Stack

```
┌─────────────────────────────────────────────────┐
│  Application Layer                              │
│  (task dispatch, coding agents, marketplaces)   │
├─────────────────────────────────────────────────┤
│  Compensation    │  Employer     │  SLA         │
│  (vesting)       │  (org budget) │  (capacity)  │
├──────────────────┤               ├──────────────┤
│  Accounting      │               │              │
│  (valuation/tax) │               │              │
├─────────────────────────────────────────────────┤
│  Verification    │  Reputation   │  Settlement  │
│  (3-tier)        │  (receipts)   │  (escrow)    │
├─────────────────────────────────────────────────┤
│  Discovery       │  Delegation   │  Context     │
│  (registry)      │  (UCAN)       │  (encrypted) │
├─────────────────────────────────────────────────┤
│  Messages  (signed JSON-RPC 2.0 over HTTP)      │
├─────────────────────────────────────────────────┤
│  Identity  (did:key + Ed25519)                  │
└─────────────────────────────────────────────────┘
```

### Core Objects

| Object | Purpose |
|---|---|
| **TaskSpec** | The "job posting" — objective, inputs, budget, deadline, verification method |
| **Offer** | A worker's bid — price, confidence, estimated duration |
| **TaskContract** | The agreement — binds requester and worker to terms |
| **ResultBundle** | The deliverable — outputs, provenance, self-assessment |
| **WorkReceipt** | The record — dual-signed proof of completed work |
| **AgentDescription** | The "business card" — capabilities, trust tier, endpoints |
| **ContextEnvelope** | Encrypted payload — X25519 key exchange + AES-256-GCM |
| **DisputeRecord** | Conflict resolution — evidence, arbitration, resolution |
| **ComputeAllocation** | Compensation grant — credits with vesting, operational/economic constraints |
| **CompensationPackage** | Complete view — all active allocations, aggregated totals, fiat valuation |
| **Organization** | Employer entity — budget, capacity sources, policies, member roster |
| **SLADefinition** | Service commitment — capacity utilization targets, periodic reporting |
| **ValuationRecord** | Credit pricing — fiat valuation with transparent audit trail |
| **ProtocolMessage** | Signed envelope — wraps all of the above for transport |

### Task Lifecycle (19 states)

```
DRAFT → ANNOUNCED → BIDDING → NEGOTIATING → CONTRACTED →
CONTEXT_SENT → IN_PROGRESS → PENDING_REVIEW → PENDING_CHALLENGE →
VALIDATING → ACCEPTED → PAYMENT_PENDING → SETTLED
                    (or) → REJECTED → DISPUTED → ARBITRATING → RESOLVED
                    (or) → CANCELLED / EXPIRED
```

### Verification Tiers

1. **Automated** — Schema validation, hash checks, test suite execution
2. **Economic** — Optimistic acceptance with staking and challenge windows (spot checks)
3. **Consensus** — k-of-n independent validators vote on result quality

### Compute as Compensation

ALXP supports using AI compute credits as a formal component of employee compensation — like equity, but for inference capacity.

- **Allocation types** — salary-compute, bonus-compute, signing-compute, retention-compute, performance-compute, project-compute
- **Vesting schedules** — immediate, cliff, linear, back-loaded, milestone (mirrors equity comp structures)
- **Constraint separation** — *operational* constraints (security, compliance) persist during employment; *economic* constraints (provider lock-in, domain restriction) drop at vesting to prevent compute comp from becoming company scrip
- **Portability guarantee** — vested credits owned by a former employee have zero constraints and are indistinguishable from credits earned any other way
- **Organizational management** — flat employer model (org + individual, optional `budgetGroup` tag), capacity source tracking, UCAN delegation for authorization
- **SLA guarantees** — periodic capacity utilization targets ("could the employee use 95% of their credits during Q1?"), not real-time uptime
- **Accounting** — fiat valuation records, tax event generation, W-2/1099 export shapes, cost center attribution

## Project Structure

```
alxp/
├── spec/                          # Protocol specification (9 documents)
│   ├── object-model.md            # 12 core objects and primitives
│   ├── state-machine.md           # 19 states, 32 transitions
│   ├── messages.md                # 8 message types, signing, transport
│   ├── identity.md                # DIDs, Ed25519, X25519, UCAN
│   ├── discovery.md               # Agent cards, capacity-based discovery
│   ├── verification.md            # 3-tier verification, Merkle provenance
│   ├── reputation.md              # Work receipts, scoring
│   ├── exchange.md                # Capacity sharing, credit economy, effort levels
│   └── threat-model.md            # 6 threat categories, mitigations
│
├── reference/                     # TypeScript reference implementation
│   ├── src/
│   │   ├── types/                 # 18 Zod schema files for all protocol objects
│   │   ├── identity/              # Ed25519 signing, DIDs, UCAN delegation
│   │   ├── messages/              # Envelope, canonicalization, validation
│   │   ├── transport/             # JSON-RPC 2.0 server + client (Hono)
│   │   ├── context/               # X25519 + AES-256-GCM encryption
│   │   ├── discovery/             # Agent cards, capability matching, registry
│   │   ├── lifecycle/             # State machine, dispute manager
│   │   ├── verification/          # Automated, economic, consensus, Merkle
│   │   ├── reputation/            # WorkReceipt-based scoring
│   │   ├── settlement/            # Escrow adapter interface
│   │   └── delegation/            # UCAN-based sub-delegation
│   │
│   ├── tests/                     # 451 tests across 29 files
│   │
│   └── examples/
│       ├── simple-requester/      # Minimal requester agent
│       ├── simple-worker/         # Minimal worker agent
│       ├── ollama-to-cloud/       # Code review with encrypted context
│       ├── math-offload/          # Math computation with sealed envelopes
│       ├── stress-test/           # Multi-agent load testing (250+ tasks)
│       ├── task-dispatch/         # Real coding task dispatch (the main demo)
│       └── capacity-sharing/      # Capacity sharing demo (donate → earn → spend)
│
└── schemas/                       # Auto-generated JSON schemas
```

## Examples

| Example | What it demonstrates |
|---|---|
| [simple-requester](reference/examples/simple-requester/) | Basic ALXP lifecycle — announce, bid, award, result, verify |
| [simple-worker](reference/examples/simple-worker/) | Worker that receives tasks and returns results |
| [ollama-to-cloud](reference/examples/ollama-to-cloud/) | Encrypted context envelopes for confidential tasks |
| [math-offload](reference/examples/math-offload/) | Sealed envelopes with Ed25519-to-X25519 key conversion |
| [stress-test](reference/examples/stress-test/) | 25 workers, 5 requesters, 250 tasks across 2 machines |
| [task-dispatch](reference/examples/task-dispatch/) | **Real coding tasks** — dispatch from your project, merge as git branches |
| [capacity-sharing](reference/examples/capacity-sharing/) | **Capacity sharing** — donate subscription capacity, earn credits, use others' models |

## Tech Stack

- **Runtime**: Node.js 20+, ESM modules
- **Schemas**: Zod v4
- **Crypto**: @noble/ed25519 + @noble/hashes (signing), @noble/curves (X25519 encryption)
- **HTTP**: Hono + @hono/node-server
- **IDs**: ULID
- **Testing**: Vitest v4

## Specification

The protocol is specified in 9 documents under [`spec/`](spec/), with 4 additional specs in draft for the compensation layer:

**Core protocol:**

- [Object Model](spec/object-model.md) — all core types, primitives, relationships
- [State Machine](spec/state-machine.md) — 19 states, 32 transitions, guard conditions
- [Messages](spec/messages.md) — message types, JSON-RPC transport binding
- [Identity](spec/identity.md) — DIDs, Ed25519 signing, X25519 encryption, UCAN delegation
- [Discovery](spec/discovery.md) — agent cards, capability matching, capacity-based queries
- [Verification](spec/verification.md) — 3-tier verification, Merkle provenance trees
- [Reputation](spec/reputation.md) — work receipt scoring, settlement, dispute impact
- [Exchange](spec/exchange.md) — capacity sharing network, credit economy, effort levels
- [Threat Model](spec/threat-model.md) — 6 threat categories, mitigations, trust tiers

**Compensation layer** (Zod schemas implemented, spec docs in draft):

- **Compensation** — compute allocations, vesting schedules, operational/economic constraint split
- **Employer Model** — flat org structure, capacity sources, budgets, UCAN delegation, policies
- **SLA** — periodic capacity utilization guarantees, compliance reporting, remediation
- **Accounting** — fiat valuation, tax events, cost center records, W-2/1099 export shapes

## License

MIT
