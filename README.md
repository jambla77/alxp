# ALXP — Agent Labor Exchange Protocol

An open protocol for AI agents to discover each other, negotiate tasks, exchange work, and verify results — across providers, frameworks, and machines.

ALXP is a **protocol**, not a platform. Like HTTP lets any web server talk to any browser, ALXP lets any AI agent request work from any other AI agent, regardless of who built them or where they run.

## Quick Start

```bash
npm install -g @alxp/cli
```

### See it work (zero config)

```bash
alxp demo
```

This runs a capacity sharing simulation: two agents donate unused AI subscription capacity, earn credits, and use each other's resources.

### Dispatch a coding task

```bash
cd ~/myproject
alxp run "Add error handling" --files src/index.ts
```

This starts a registry, worker, and requester on your machine, sends your files through the full ALXP lifecycle, and merges the result into a git branch for review.

### Use a real LLM

```bash
# Ollama (free, local)
alxp run "Add input validation" --files src/form.tsx --solver openai --model codellama

# Claude
alxp run "Write unit tests" --files src/auth.ts --solver claude

# Any OpenAI-compatible API
alxp run "Refactor to async" --files src/api.ts --solver openai --model gpt-4 --api-key $OPENAI_API_KEY
```

### Run a standalone worker

Share your compute capacity on the network:

```bash
# On a GPU server:
alxp serve --solver openai --model codellama --registry http://192.168.2.81:19600

# On another machine:
alxp registry
alxp run "Add tests" --files src/ --registry-port 19600
```

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

## CLI Reference

```
alxp demo                                    # Capacity sharing demo (zero config)
alxp run <objective> [options]               # Dispatch a coding task
alxp serve [options]                         # Start a standalone worker
alxp registry [options]                      # Start a standalone registry
```

### `alxp run` options

| Option | Default | Description |
|---|---|---|
| `--files <paths>` | auto-detect | Comma-separated file paths |
| `--solver <name>` | `echo` | `echo`, `openai`, or `claude` |
| `--model <name>` | `codellama` | LLM model name |
| `--llm-endpoint <url>` | `localhost:11434` | OpenAI-compatible API endpoint |
| `--api-key <key>` | `$OPENAI_API_KEY` | API key for the LLM provider |
| `--task-file <path>` | | Path to tasks.json |
| `--project-root <path>` | cwd | Project root directory |
| `--timeout <ms>` | `120000` | Task timeout |

### `alxp serve` options

| Option | Default | Description |
|---|---|---|
| `--solver <name>` | `echo` | `echo`, `openai`, or `claude` |
| `--model <name>` | `codellama` | LLM model name |
| `--registry <url>` | `localhost:19600` | Registry URL to register with |
| `--port <port>` | `19700` | Worker port |

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

## Developing

### From source

```bash
git clone https://github.com/jambla77/alxp.git
cd alxp
npm install

# Run tests (451 tests across 29 files)
cd reference && npm test

# Build CLI
cd ../cli && npm run build
node bin/alxp.js demo
```

### Project Structure

```
alxp/
├── cli/                           # CLI tool (@alxp/cli)
├── spec/                          # Protocol specification (13 documents)
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
│   ├── tests/                     # 451 tests across 29 files
│   └── examples/                  # Example agents and demos
├── mcp-server/                    # MCP server for Claude Desktop integration
└── schemas/                       # Auto-generated JSON schemas
```

### Examples

| Example | What it demonstrates |
|---|---|
| [simple-requester](reference/examples/simple-requester/) | Basic ALXP lifecycle — announce, bid, award, result, verify |
| [simple-worker](reference/examples/simple-worker/) | Worker that receives tasks and returns results |
| [ollama-to-cloud](reference/examples/ollama-to-cloud/) | Encrypted context envelopes for confidential tasks |
| [math-offload](reference/examples/math-offload/) | Sealed envelopes with Ed25519-to-X25519 key conversion |
| [stress-test](reference/examples/stress-test/) | 25 workers, 5 requesters, 250 tasks across 2 machines |
| [task-dispatch](reference/examples/task-dispatch/) | Real coding task dispatch with git branch merging |
| [capacity-sharing](reference/examples/capacity-sharing/) | Capacity sharing — donate, earn credits, use others' models |

## Specification

The protocol is specified in 13 documents under [`spec/`](spec/):

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

**Compensation layer:**

- [Compensation](spec/compensation.md) — compute allocations, vesting schedules, operational/economic constraint split
- [Employer Model](spec/employer-model.md) — flat org structure, capacity sources, budgets, UCAN delegation
- [SLA](spec/sla.md) — periodic capacity utilization guarantees, remediation policies
- [Accounting](spec/accounting.md) — fiat valuation, tax events, cost center records, W-2/1099 export shapes

## License

MIT
