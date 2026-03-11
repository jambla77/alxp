# ALXP Task Dispatch — User Guide

Dispatch real coding tasks from your project to AI worker agents over the network, and merge the completed code back as git branches.

## Quick Start (30 seconds)

Test the full pipeline locally with the echo solver (no LLM needed):

```bash
cd reference

# Create a test project
mkdir -p /tmp/test-project && cd /tmp/test-project
git init && echo 'console.log("hello")' > index.js && git add -A && git commit -m "init"

# Run the pipeline
cd /path/to/agent-protocol/reference
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root /tmp/test-project \
  --objective "Add error handling" \
  --files index.js \
  --solver echo
```

The echo solver returns files unchanged — this verifies the full lifecycle works: context collection, ALXP dispatch, bidding, result submission, git branch creation, and commit.

---

## Part 1: Outsourcing Tasks From Your Project

You're a developer. You want to send coding tasks from your local project to AI agents and get the modified code back as reviewable git branches.

### Prerequisites

- Your project must be a **git repository** with a **clean working tree** (no uncommitted changes)
- All commands run from the `reference/` directory

### Option A: Ad-hoc single task

Send one task with an objective and specific files:

```bash
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root ~/myproject \
  --objective "Add input validation to the signup form" \
  --files src/components/SignupForm.tsx,src/utils/validation.ts \
  --solver openai --llm-model codellama
```

### Option B: Task file with multiple tasks

Create a `tasks.json` in your project root:

```json
{
  "tasks": [
    {
      "objective": "Add error handling to the API routes",
      "context": {
        "files": ["src/routes/api.ts", "src/middleware/error.ts"]
      },
      "tags": ["typescript", "error-handling"]
    },
    {
      "objective": "Write unit tests for the auth module",
      "context": {
        "files": ["src/auth/login.ts", "src/auth/session.ts"]
      },
      "tags": ["testing"]
    },
    {
      "objective": "Refactor database queries to use prepared statements",
      "context": {
        "include": ["src/db/**/*.ts"],
        "exclude": ["src/db/**/*.test.ts"]
      },
      "tags": ["security", "sql"]
    }
  ]
}
```

Then dispatch all tasks:

```bash
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root ~/myproject \
  --task-file tasks.json \
  --solver claude
```

Multiple tasks dispatch **in parallel** to different workers. Each task gets its own git branch.

### Context Selection

You control which files the agent sees. Three modes:

**1. Explicit files** — list exactly which files to include:
```json
{
  "objective": "Fix the sorting bug",
  "context": {
    "files": ["src/utils/sort.ts", "src/utils/sort.test.ts"]
  }
}
```

**2. Glob patterns** — include/exclude by pattern:
```json
{
  "objective": "Add TypeScript strict mode fixes",
  "context": {
    "include": ["src/**/*.ts", "src/**/*.tsx"],
    "exclude": ["**/*.test.ts", "**/*.spec.ts", "node_modules/**"]
  }
}
```

**3. Auto-detect** — omit `context` entirely. The system runs `git ls-files`, filters to code file extensions, and collects files up to a 500KB budget:
```json
{
  "objective": "Improve code documentation",
  "tags": ["docs"]
}
```

### Reviewing Results

Each completed task creates a git branch named `alxp/<task-id>/<objective-slug>`. After dispatch completes, you'll see output like:

```
═══════════════════════════════════════════════════════
Results:
═══════════════════════════════════════════════════════

  [OK] Add error handling to the API routes (2340ms)
    Branch: alxp/a1b2c3d4/add-error-handling-to-the-api-routes
    Files:  src/routes/api.ts, src/middleware/error.ts
    Commit: f8a2e1c
    Review: git diff main...alxp/a1b2c3d4/add-error-handling-to-the-api-routes

  [OK] Write unit tests for the auth module (4120ms)
    Branch: alxp/e5f6g7h8/write-unit-tests-for-the-auth-module
    Files:  src/auth/login.ts, src/auth/session.ts
    Commit: b3c9d4a
    Review: git diff main...alxp/e5f6g7h8/write-unit-tests-for-the-auth-module

2/2 tasks completed.
```

Review a branch:

```bash
cd ~/myproject

# See the diff
git diff main...alxp/a1b2c3d4/add-error-handling-to-the-api-routes

# Merge if you like the changes
git merge alxp/a1b2c3d4/add-error-handling-to-the-api-routes

# Or cherry-pick specific commits
git cherry-pick f8a2e1c

# Clean up branches you don't want
git branch -D alxp/a1b2c3d4/add-error-handling-to-the-api-routes
```

---

## Part 2: Running Worker Agents

You want to run AI agents that accept and complete coding tasks from the network.

### Starting a Worker

A worker needs a **registry** to register with, and a **solver** to process tasks.

#### Echo solver (testing)

```bash
npx tsx examples/task-dispatch/serve.ts \
  --registry http://192.168.2.81:19600 \
  --solver echo
```

#### Ollama (local LLM)

Make sure Ollama is running (`ollama serve`), then:

```bash
npx tsx examples/task-dispatch/serve.ts \
  --registry http://192.168.2.81:19600 \
  --solver openai \
  --llm-model codellama
```

The default endpoint is `http://localhost:11434/v1/chat/completions` (Ollama's OpenAI-compatible API). Override with `--llm-endpoint` for other providers.

#### OpenAI

```bash
npx tsx examples/task-dispatch/serve.ts \
  --registry http://192.168.2.81:19600 \
  --solver openai \
  --llm-endpoint https://api.openai.com/v1/chat/completions \
  --llm-model gpt-4o \
  --llm-api-key sk-...
```

Or set `OPENAI_API_KEY` in your environment instead of `--llm-api-key`.

#### Claude

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx examples/task-dispatch/serve.ts \
  --registry http://192.168.2.81:19600 \
  --solver claude \
  --anthropic-model claude-sonnet-4-20250514
```

#### Other OpenAI-compatible providers

Works with **vLLM**, **LM Studio**, **Together AI**, **Groq**, or any service that implements the `/v1/chat/completions` endpoint:

```bash
npx tsx examples/task-dispatch/serve.ts \
  --registry http://192.168.2.81:19600 \
  --solver openai \
  --llm-endpoint http://localhost:8000/v1/chat/completions \
  --llm-model my-model
```

### What the Worker Does

When a worker starts, it:

1. Generates a unique Ed25519 identity (DID)
2. Starts an HTTP server on `--worker-port` (default 19700)
3. Registers with the registry as a `coding` domain worker
4. Waits for `ANNOUNCE_TASK` messages

When a task arrives:

1. Auto-bids on the task (sends `BID` to the requester)
2. Receives `AWARD` with the contract and file contents
3. Passes the objective + files to the configured solver
4. Sends `SUBMIT_RESULT` with modified files back to the requester

The worker stays running and handles tasks as they come. Press Ctrl+C to stop.

---

## Part 3: Cross-Network Setup

Run the requester and workers on different machines on your LAN.

### Step 1: Start the Registry (on the requester's machine)

The registry is started automatically by `dispatch.ts` — but for cross-network, you can start it explicitly or let `run.ts` handle it. The simplest approach: run `dispatch.ts` which uses an existing registry, or run the full orchestrator on one machine and workers on another.

For a dedicated registry, use the stress-test registry pattern:

```bash
# Machine A (requester) — registry starts on port 19600
npx tsx examples/task-dispatch/dispatch.ts \
  --project-root ~/myproject \
  --task-file tasks.json \
  --registry http://192.168.2.81:19600
```

Note: `dispatch.ts` expects the registry to already be running. For cross-network, start the registry separately or use `run.ts` which starts its own.

### Step 2: Start Workers (on remote machines)

```bash
# Machine B (worker)
cd reference
npx tsx examples/task-dispatch/serve.ts \
  --registry http://192.168.2.81:19600 \
  --solver openai --llm-model codellama \
  --worker-port 19700
```

```bash
# Machine C (another worker, different solver)
cd reference
npx tsx examples/task-dispatch/serve.ts \
  --registry http://192.168.2.81:19600 \
  --solver claude \
  --worker-port 19700
```

### Step 3: Dispatch from the requester

```bash
# Machine A
npx tsx examples/task-dispatch/dispatch.ts \
  --project-root ~/myproject \
  --task-file tasks.json \
  --registry http://192.168.2.81:19600
```

The dispatcher discovers all registered workers, distributes tasks round-robin, and merges results as they come back.

### Typical Cross-Network Setup

```
Developer Laptop (192.168.2.81)        GPU Server (192.168.2.87)
┌───────────────────────────┐          ┌──────────────────────────┐
│  Registry (:19600)        │◄─────────│  serve.ts                │
│  dispatch.ts              │          │  --solver openai          │
│                           │          │  --llm-model codellama    │
│  ~/myproject/             │          │  Ollama running locally   │
│  ├── src/                 │          └──────────────────────────┘
│  ├── tasks.json           │
│  └── .git/                │          Mac Mini (192.168.2.90)
│                           │          ┌──────────────────────────┐
│  Results merged into      │◄─────────│  serve.ts                │
│  alxp/* git branches      │          │  --solver claude          │
└───────────────────────────┘          └──────────────────────────┘
```

---

## CLI Reference

All flags work with `run.ts`, `dispatch.ts`, and `serve.ts`:

### Project & Task Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--project-root` | current directory | Path to the project to work on |
| `--task-file` | — | Path to tasks.json (relative to project root) |
| `--objective` | — | Single task objective (alternative to --task-file) |
| `--files` | — | Comma-separated file paths for context |

### Network Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--registry` | `http://<local-ip>:19600` | Registry URL |
| `--registry-port` | `19600` | Registry listen port |
| `--worker-port` | `19700` | Worker listen port |
| `--requester-port` | `19800` | Requester listen port |
| `--local-ip` | auto-detected | Override LAN IP |
| `--local-only` | off | Bind to 127.0.0.1 instead of 0.0.0.0 |

### Solver Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--solver` | `echo` | `echo`, `openai` (or `llm`), `claude` |
| `--llm-endpoint` | `http://localhost:11434/v1/chat/completions` | OpenAI-compatible API URL |
| `--llm-model` | `codellama` | Model name |
| `--llm-api-key` | `$OPENAI_API_KEY` | API key (optional for Ollama) |
| `--anthropic-model` | `claude-sonnet-4-20250514` | Claude model |

### Other Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--task-timeout` | `120000` | Per-task timeout in milliseconds |

---

## tasks.json Format

```json
{
  "tasks": [
    {
      "objective": "What you want done (required)",
      "context": {
        "files": ["explicit/paths.ts"],
        "include": ["src/**/*.ts"],
        "exclude": ["**/*.test.ts"]
      },
      "tags": ["optional", "metadata"]
    }
  ]
}
```

Context selection priority:
1. `files` — explicit paths (if provided, include/exclude are ignored)
2. `include`/`exclude` — glob patterns
3. Auto-detect — `git ls-files` filtered to code extensions, up to 500KB

---

## Examples

### Test the pipeline works

```bash
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root ~/myproject \
  --objective "Test" --files README.md \
  --solver echo
```

### Refactor with a local Ollama model

```bash
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root ~/myproject \
  --objective "Convert all var declarations to const/let" \
  --files src/legacy.js \
  --solver openai --llm-model codellama
```

### Send multiple tasks to Claude

```bash
# tasks.json:
# {
#   "tasks": [
#     { "objective": "Add JSDoc to all exported functions", "context": { "include": ["src/lib/**/*.ts"] } },
#     { "objective": "Add error boundaries to React components", "context": { "include": ["src/components/**/*.tsx"] } }
#   ]
# }

export ANTHROPIC_API_KEY=sk-ant-...
npx tsx examples/task-dispatch/run.ts --local-only \
  --project-root ~/myproject \
  --task-file tasks.json \
  --solver claude
```

### Outsource to a remote GPU server running Ollama

```bash
# On the GPU server:
npx tsx examples/task-dispatch/serve.ts \
  --registry http://192.168.2.81:19600 \
  --solver openai --llm-model deepseek-coder-v2

# On your laptop:
npx tsx examples/task-dispatch/run.ts \
  --project-root ~/myproject \
  --task-file tasks.json
```

---

## Safety Notes

- The result merger **refuses to run** if your working tree has uncommitted changes
- Path traversal is blocked — agents cannot write files outside the project root
- Each task result goes to its **own git branch** — nothing is merged into your main branch automatically
- You always review with `git diff` before merging
- The echo solver is useful for verifying the pipeline without any LLM costs
