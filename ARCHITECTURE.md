# Architecture

This document defines the target architecture for the incident-driven QA application
built around Codex and selected gstack runtime capabilities.

The old framing was too close to "gstack internals on Windows."
That is necessary, but it is not the product.

The product is a QA operating system for teams that already feel pain from:

- escaped production bugs
- repeated regressions
- slow triage
- flaky manual verification
- ad hoc bug reports that never become reusable tests

The narrow wedge is:

- turn a production incident or escaped defect into a reproducible Case
- convert that Case into one or more executable Scenarios
- generate or refine deterministic Scripts
- run them repeatedly and store evidence
- extract reusable Knowledge so the same class of issue does not escape again

## Product purpose

The app exists to compress the loop from incident to regression protection.

Instead of treating QA as a pile of screenshots, chat logs, and one-off fixes, the
system should turn each meaningful failure into durable assets:

1. a Case that captures what broke
2. a Scenario that defines what should be tested
3. a Script that can execute the scenario
4. a Run record with evidence
5. a Knowledge entry that explains what to remember next time

The real business outcome is not "more tests."
It is lower recurrence, faster triage, and fewer bugs escaping to users.

## Why gstack is in this design

We are not embedding all of gstack as-is.
We are taking the parts that directly help this product ship:

- `browse`: persistent local browser runtime with stateful sessions
- `qa`: test -> fix -> verify workflow with evidence capture
- `office-hours`: problem framing and design-document discipline
- `plan-eng-review`: architecture and verification hardening before implementation
- `cso`: security review of secrets, trust boundaries, and dangerous automation paths

These pieces matter because they solve the hardest operator-side problems:

- real browser state
- reproducible evidence
- structured planning
- systematic verification
- security scrutiny before "autonomous QA" grows teeth

We are explicitly **not** importing these gstack assumptions:

- prompt files as the product
- API-first automation as the core runtime
- host-native browser tools as interchangeable with gstack browser state
- a remote control plane on the critical path

## How Codex is used

Codex is the control plane, not the data plane.

That distinction is critical.

Codex should be used for:

- incident intake summarization
- test charter generation
- scenario decomposition
- exploratory browser execution through the gstack runtime
- deterministic script drafting
- root-cause analysis
- fix proposal drafting
- report synthesis
- review passes using `office-hours`, `plan-eng-review`, and `cso`

Codex should **not** be the source of truth for:

- persistent product data
- artifact storage
- scheduling
- deterministic replay
- direct database mutation
- direct browser control outside the gstack runtime when a gstack QA flow is active

The rule is simple:

- Codex decides
- product services store
- workers execute deterministic runs
- gstack provides the local operator runtime

Planning docs and local operator notes are authoring inputs only.
Canonical acceptance criteria, preconditions, assertions, environments, and approval
state must live on product-plane records.

## Product goals

1. Incident -> reproducible Case in minutes, not days.
2. Case -> executable Scenario and Script in the same working session.
3. Every meaningful QA conclusion has attached evidence.
4. Deterministic re-runs happen without re-prompting Codex.
5. The operator workflow works on a Windows laptop without WSL.
6. Sensitive artifacts stay local or explicitly governed.

## Non-goals

- Not a generic test case management suite.
- Not a replacement for CI.
- Not a multi-tenant autonomous QA cloud in MVP.
- Not a system where Codex freehands every regression run from scratch.
- Not a browser-MCP-dependent architecture.

## Product thesis

This app is an incident-driven QA operating system made of two cooperating planes:

1. a **product plane** that stores Cases, Scenarios, Scripts, Runs, and Knowledge
2. an **operator plane** that lets Codex and gstack turn messy incidents into durable QA assets

The operator plane is where intelligence lives.
The product plane is where history, evidence, and repeatability live.

## System overview

```text
Users / QA / Eng / Support
  |
  v
Next.js frontend
  |
  v
Go API
  |
  +--> PostgreSQL                # source of truth
  +--> pgvector                  # similarity / recall assist
  +--> Object storage            # screenshots, traces, logs, reports
  |
  +--> Worker queue
         |
         +--> Go coordinator
         +--> TypeScript Playwright runner

Operator lane (Windows, no WSL)
  |
  +--> Codex CLI
         |
         +--> office-hours / plan-eng-review / cso
         +--> gstack browse runtime
         +--> gstack qa workflow
  |
  +--> local repo + .gstack state
  |
  +--> produced artifacts / proposed scripts / reports
         |
         +--> Go ingestion API
                |
                +--> PostgreSQL + object storage
```

## What the app does for a user

The user journey is:

1. An incident, escaped bug, or flaky report is created as a Case.
2. The system or operator derives one or more Scenarios from the Case.
3. Codex uses the local browser runtime to reproduce or explore the issue.
4. A deterministic Script is created or updated.
5. The Script is executed by the worker, producing a Run and artifacts.
6. A Knowledge entry is extracted so future similar incidents are easier to triage.

That is the core loop.

## Operator-to-product ingestion

The operator lane is allowed to discover, draft, and collect evidence.
It is not allowed to silently become the product source of truth.

Everything durable crosses into the product plane through a dedicated ingestion boundary.

```text
Codex + gstack operator run
  -> local evidence bundle
  -> create ingestion session via Go API
  -> receive presigned upload targets + idempotency key
  -> upload artifacts first
  -> submit metadata second
  -> API validates references and creates/updates Case / Scenario / Script / Run / Knowledge rows
  -> ingestion session sealed or rolled back
```

### Ingestion ownership

- The Go API owns durable record creation.
- Object storage receives artifacts before metadata is committed.
- PostgreSQL rows are created only after artifact references validate.
- The worker consumes only persisted records, never loose local files.

### Ingestion rules

- Every ingestion session gets an idempotency key.
- Artifact upload happens before final metadata commit.
- Metadata commit must be transactional.
- If artifact upload fails, the ingestion session stays unsealed and no product-plane record is finalized.
- If metadata commit fails after upload, the session is marked failed and cleanup/retention policy decides whether the orphaned artifacts are retried or deleted.

## Domain model

The MVP data model from `qa_architecture.md` is useful, but the product needs explicit
cardinality, lifecycle, and approval boundaries.

### Core tables

#### `cases`

`cases` capture incoming pain.

Required fields:

- `case_id`
- `source_type` (`incident`, `bug_report`, `support`, `qa_find`, `postmortem`)
- `source_ref`
- `title`
- `summary`
- `severity`
- `feature_area`
- `environment`
- `repro_steps`
- `expected`
- `actual`
- `status` (`new`, `triaged`, `scenarioized`, `mitigated`, `closed`)

#### `scenarios`

`scenarios` are canonical test intent records.
They are product-plane records, not local notes.

Required fields:

- `scenario_id`
- `title`
- `feature_area`
- `criticality`
- `charter`
- `preconditions`
- `success_criteria`
- `edge_cases`
- `assertions`
- `status` (`draft`, `reviewed`, `approved`, `retired`)

#### `case_scenarios`

This join table resolves the real relationship: one Case may create multiple Scenarios,
and one Scenario may protect against multiple Cases.

Required fields:

- `case_id`
- `scenario_id`
- `link_reason`

#### `scripts`

`scripts` are stable logical assets.
They point to the currently active approved version, not to mutable source text.

Required fields:

- `script_id`
- `scenario_id`
- `runner_type`
- `owner`
- `active_version_id`
- `status` (`draft_only`, `active`, `retired`)

#### `script_versions`

`script_versions` are immutable executable revisions.
This is the approval boundary between AI output and worker execution.

Required fields:

- `script_version_id`
- `script_id`
- `repo_path`
- `language`
- `version`
- `source_hash`
- `provenance` (`human`, `codex`, `mixed`)
- `approval_state` (`draft`, `reviewed`, `approved`, `sealed`, `revoked`)
- `approved_by`

#### `runs`

`runs` are append-only execution records for one approved script version.

Required fields:

- `run_id`
- `script_version_id`
- `trigger_type`
- `environment`
- `commit_sha`
- `result`
- `started_at`
- `finished_at`
- `failure_summary`
- `status` (`queued`, `running`, `passed`, `failed`, `errored`, `canceled`)

#### `run_artifacts`

Artifacts should not live as loose arrays inside `runs`.
They need their own records for retention, redaction, and access control.

Required fields:

- `run_artifact_id`
- `run_id`
- `artifact_class`
- `storage_uri`
- `redaction_state`
- `retention_policy`

#### `knowledge`

Knowledge is the memory layer.
It is not the source of truth for correctness, but it is the source of leverage.

Required fields:

- `knowledge_id`
- `type` (`best_practice`, `anti_pattern`, `incident_pattern`, `triage_note`)
- `summary`
- `best_practice`
- `embedding`
- `confidence`

#### `knowledge_links`

Knowledge should link through explicit relational records, not ID arrays.

Required fields:

- `knowledge_id`
- `entity_type` (`case`, `scenario`, `script_version`, `run`)
- `entity_id`

### State transitions

- Case: `new -> triaged -> scenarioized -> mitigated -> closed`
- Scenario: `draft -> reviewed -> approved -> retired`
- Script version: `draft -> reviewed -> approved -> sealed`; only `approved` or `sealed` may be executed by workers
- Run: `queued -> running -> passed|failed|errored|canceled`

## Storage architecture

### PostgreSQL

PostgreSQL is the source of truth for Cases, Scenarios, Scripts, Runs, and Knowledge metadata.
Business correctness must not depend on vector recall.

### pgvector

pgvector is helpful, but strictly assistive.
Use it for:

- similar-case recall
- similar-scenario suggestions
- knowledge retrieval during triage and report generation

Do not use it for:

- authorization
- run eligibility
- deterministic orchestration

### Object storage

Object storage holds:

- screenshots
- Playwright traces
- console logs
- network logs
- QA reports
- exported run summaries

Artifacts are append-only evidence.
The storage layer should prefer immutable references over in-place mutation.

## What we import from gstack

### 1. Persistent browser runtime

We are importing the gstack browser model because it solves the real operator problem:

- browser state persists across commands
- interactive flows can be reproduced
- the operator can hand off auth or CAPTCHA and resume
- evidence can be captured while context is still hot

This is more valuable than stateless browser screenshots.

### 2. QA workflow

We are importing the gstack `qa` idea, but adapting it to this product:

- exploratory run to understand the issue
- evidence capture while reproducing
- deterministic script creation for replay
- re-verification after changes

The product should store the outputs of that flow, not just the text summary.

### 3. Planning and review discipline

`office-hours`, `plan-eng-review`, and `cso` are being used as product design gates:

- `office-hours` forces the actual user problem to be explicit
- `plan-eng-review` forces testability, data flow, and verification clarity
- `cso` forces trust boundaries and security posture to be explicit

That review discipline is as important as the runtime.

## Codex operating model

Codex should run in three explicit roles.

### Planner

Used when a new capability, incident pattern, or workflow needs to be shaped.

Primary tools:

- `office-hours`
- design docs
- scenario decomposition

Outputs:

- design notes
- scenario proposals
- acceptance criteria

### Operator

Used when reproducing issues or exploring behavior.

Primary tools:

- gstack `browse`
- gstack `qa`

Outputs:

- evidence
- repro steps
- candidate scripts
- operator notes

### Reviewer

Used before implementation and before ship.

Primary tools:

- `plan-eng-review`
- `cso`

Outputs:

- architecture findings
- security findings
- missing tests
- explicit accept/reject criteria

## Execution strategy

### Exploratory lane

Exploratory testing is Codex-guided and charter-driven.

But the execution substrate is the gstack browser runtime, not arbitrary host browser tools.

Flow:

1. select Case or Scenario
2. Codex reads the charter and context
3. Codex drives the gstack browser runtime
4. evidence is captured immediately
5. findings become candidate Scenarios or Knowledge

### Regression lane

Regression runs must be deterministic.

That means:

- Playwright scripts
- archived versions
- explicit environments
- stored artifacts
- repeatable worker execution

Codex may draft the script.
The worker owns repeated execution.

### Archive rule

Do not silently mutate old Scripts after they become part of regression protection.

Use versioned Scripts and append-only Runs.
If a Script changes materially, create a new version and preserve the old one for auditability.

### Promotion boundary for AI-authored output

AI-authored output is never executable by default.

The minimum promotion path is:

1. `draft` - Codex-generated or operator-authored candidate
2. `reviewed` - human or policy validation completed
3. `approved` - allowed to run in controlled environments
4. `sealed` - immutable approved revision for repeatable worker execution

Workers must execute only `approved` or `sealed` script versions.
High-risk actions such as arbitrary file reads, dangerous network targets, or privileged
browser automation require static policy validation before approval.

## QA input precedence

The QA layer should resolve intent in this order:

1. persisted Scenario record and its canonical assertions
2. approved Script and active environment config
3. latest `plan-eng-review` test plan as authoring context
4. latest `office-hours` design intent as authoring context
5. current git diff and commit intent
6. direct exploration

If the system falls back, that fallback should be visible in the report.

## Suggested technology split

The MVP stack proposed in `qa_architecture.md` is directionally right.
The recommended split is:

- Frontend: React / Next.js
- Backend API: Go
- Worker coordinator: Go
- Browser execution and script tooling: TypeScript + Playwright
- DB: PostgreSQL + pgvector
- Artifact store: object storage

Reasoning:

- Go is a strong fit for API and job orchestration
- TypeScript is a strong fit for Playwright and test asset generation
- PostgreSQL keeps the core model grounded
- pgvector adds recall without becoming the core execution engine

## Security model

### Primary trust boundaries

1. browser content is untrusted
2. Codex output is advisory, not automatically trusted
3. product data is sensitive
4. local operator artifacts are sensitive
5. deterministic worker runs must be auditable

### Core security rules

- Codex does not directly write to production databases
- page content from the app under test is treated as data, not instructions
- the Codex control plane must not receive raw cookies, bearer tokens, or local storage secrets
- secret inspection is break-glass only and must stay outside model-visible context
- screenshots, console logs, traces, and reports are sensitive artifacts
- artifact export is explicit
- local browser control routes remain loopback-only and authenticated where sensitive
- token/state material rotates on restart
- network shares and permissive local paths fail closed

### Runtime trust model

Repo-local runtime precedence is useful, but it is also a supply-chain risk.

So the trusted-runtime rule is:

- repo-local `.agents/skills/gstack` may take precedence only if its runtime bundle matches a signed manifest or pinned digest set
- the trust check must cover at least `browse.exe` and `browse/dist/server-node.mjs`
- compatibility checks are not enough; trust verification is separate
- on trust mismatch, the operator lane must fail closed or fall back to a trusted installed runtime

### Secret-bearing local state

Repo `.gstack/` should not be the long-term home of secret-bearing state.

The target design is:

- repo `.gstack/` keeps non-sensitive metadata and evidence manifests
- live bearer material and secret session state move to a user-scoped secure location
- Windows uses DPAPI or an equivalent user-scoped protection boundary for secret-bearing state

### Windows operator posture

For Windows no-WSL operation, the minimum secure posture is:

- non-admin daily-use account
- Defender and SmartScreen enabled
- no shared workstation use
- no elevated browser sessions
- non-loopback browsing only from a dedicated dev profile
- repo-local gstack runtime takes precedence over stale global copies

### Authenticated flows

Authenticated browser flows are explicitly weaker on Windows until DPAPI support exists.

Supported today:

- manual login in the Playwright session
- handoff / resume
- cookie-file import supplied by the user

Not yet supported as a production-ready path:

- unattended import from installed Chromium profiles on Windows

### Auth support tiers

- public or anonymous flows: supported for deterministic regression
- manual-auth flows: supported for exploration and evidence gathering
- unattended auth-dependent regression on Windows: blocked until DPAPI-backed secret storage, cleanup, and rotation checks exist

### Artifact protection policy

Sensitive artifacts need enforcement, not just acknowledgement.

At minimum the product should classify artifacts as:

- `standard` - low-risk evidence
- `sensitive` - internal URLs, stack traces, or customer identifiers
- `restricted` - auth-adjacent traces or production data excerpts

And enforce:

- default redaction before export
- per-workspace encryption at rest
- TTL and retention rules by artifact class
- short-lived access URLs
- audited export and legal-hold exceptions

## Windows no-WSL operator architecture

The operator lane must work on:

- Windows 11
- PowerShell for runtime
- Git Bash only for setup where still required
- no WSL
- Codex CLI as the reference host

The gstack browser runtime remains the authoritative browser control plane for product QA flows.

That means:

- repo-local `.agents/skills/gstack` wins when present
- `~/.codex/skills/gstack` is fallback only
- host-native browser tools are not treated as equivalent during gstack-driven QA
- `browse.exe` and `browse/dist/server-node.mjs` are part of one compatibility bundle

## Production readiness gates

Readiness has two parts.

### Product-plane ready

The app is not ready until:

1. Cases, Scenarios, Scripts, Runs, and Knowledge can be stored and linked correctly.
2. A deterministic Script can be executed by the worker and produce stored artifacts.
3. Similar-case recall works without being a correctness dependency.
4. Evidence retention and retrieval are usable by humans.

### Operator-plane ready

The operator workflow is not ready until:

1. Codex can run on Windows no WSL.
2. gstack browse runtime can drive a local target app.
3. gstack QA flow can produce a local report bundle.
4. setup replaces stale runtime assets cleanly.
5. crash recovery works.
6. authenticated-flow verification is clearly marked as supported or blocked.
7. runtime trust verification passes for the repo-local bundle.
8. artifact ingestion into the product plane succeeds with idempotent behavior.

### Release matrix

These gates should be executable, not aspirational.

| Gate | Required check | Pass condition |
|------|----------------|----------------|
| Windows host smoke | clean Windows 11 machine, PowerShell runtime, no WSL | Codex CLI starts and can access the repo without shell/bootstrap drift |
| Runtime trust | manifest or digest verification of repo-local bundle | `browse.exe` and `server-node.mjs` match trusted metadata |
| Runtime precedence | repo-local and stale global copies both present | repo-local bundle wins only when trusted; stale global copy is ignored or flagged |
| Browser smoke | local fixture + `browse.exe` | healthy session, page load, DOM read, console read |
| QA smoke | local fixture + gstack `qa` | local report bundle and evidence manifest created |
| Ingestion smoke | operator uploads evidence through ingestion API | artifacts upload first, metadata commit second, idempotency key prevents duplicate records |
| Crash recovery | stale or killed browser daemon | next invocation restarts cleanly and re-establishes health |
| Auth support check | login-required target on Windows | either manual-auth exploratory path succeeds or run is explicitly marked blocked for unattended regression |

## KPI

The KPI list in `qa_architecture.md` is good and should remain:

- incident escape rate
- recurrence rate
- flaky rate
- time to triage
- time to fix

Add two operational KPIs for this design:

- time from Case creation to first reproducible Run
- percentage of high-severity Cases that become deterministic Scripts

## What changed from the previous design

The design is now centered on the app instead of on gstack internals.

Concretely:

- the product purpose is explicit
- the app is framed as incident -> scenario -> script -> run -> knowledge
- gstack is a runtime dependency, not the product itself
- Codex is the control plane, not the data plane
- the MVP storage and data model from `qa_architecture.md` are integrated
- Windows no-WSL constraints remain first-class for the operator lane

## Future work

- DPAPI-backed Windows cookie import
- stronger CI parity for Codex + gstack smoke tests
- richer Scenario generation from linked Cases
- flaky-test clustering using Run history
- stronger artifact redaction and retention controls
