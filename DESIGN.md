# DESIGN

## Summary

gstack is no longer framed as an API-first prompt pack.

The source of truth for this phase is:

- Windows 11 notebook
- No WSL
- Codex CLI as the primary control plane
- `browse` as a mandatory local runtime
- `qa` as the production-readiness gate

The old mental model was "skills that happen to call APIs."
The new mental model is "a local AI engineering workstation with a browser-backed verification loop."

## Product Reframe

### User

A solo builder on a Windows notebook wants to run ideation, planning, coding, review, browser QA, and ship checks from one repo without:

- WSL
- hand-written API integrations
- remote browser infrastructure
- prompt glue spread across multiple tools

### Core Job

Turn a local Windows machine into a reliable engineering workbench where Codex can:

1. reason over project docs and code
2. drive a persistent local browser
3. run repeatable QA loops
4. prove readiness with local evidence

### Narrowest Wedge

The narrowest useful wedge is not "all skills on all hosts."

It is:

- Codex-first workflow
- local `browse` daemon
- `/qa`-style verification loop
- deterministic Windows setup and smoke tests

If this wedge is solid, the rest of the skill catalog compounds on top.

## Design Principles

1. Local-first beats API-first.
2. Windows is a first-class target, not a compatibility footnote.
3. Browser evidence beats verbal claims.
4. QA is a ship gate, not a side quest.
5. Manual auth handoff is safer than leaking secrets into model context.
6. Production confidence requires executable checks, not only architecture prose.

## Architecture

### System Diagram

```text
User
  |
  v
Codex CLI
  |
  +--> generated skills in .agents/skills/
  |
  +--> local repo docs + code + plans
  |
  +--> browse/dist/browse
          |
          v
      server-node.mjs on Windows
          |
          v
      Playwright + local Chromium
          |
          v
      target app + local artifacts in .gstack/
```

### Verification Loop

```text
/office-hours -> DESIGN.md
                |
                v
         /plan-eng-review
                |
                v
          implementation
                |
                v
              /qa
                |
                +--> browse screenshots
                +--> console/network evidence
                +--> baseline.json
                +--> regression tests when justified
                |
                v
          ship / no-ship decision
```

### Trust Boundaries

```text
Codex CLI / skill prompts
  |
  | reads local repo + generated skills
  v
Local execution host
  |
  | localhost bearer token
  v
browse client <-> browse server
  |
  | Playwright automation
  v
target application
  |
  | screenshots, logs, baselines
  v
.gstack/ artifacts (local only, gitignored)
```

## Components

### 1. Control Plane: Codex CLI

Codex CLI is the primary operator runtime on Windows.

- Authentication comes from Codex's installed login state, not ad hoc API key plumbing.
- Skills are generated into `.agents/skills/` and installed repo-local or user-global.
- Windows sandbox defaults must assume `workspace-write`, because read-only modes can block normal git reads in practice.

### 2. Execution Plane: Fast Local Browser

`browse` is not optional infrastructure. It is part of the product.

- The compiled CLI is the stable entry point.
- The browser server is persistent and local.
- On Windows, the runtime path is `browse` -> `server-node.mjs` -> Playwright -> Chromium.
- Localhost HTTP plus bearer token is the transport boundary.
- State, logs, screenshots, and baselines stay inside repo-local `.gstack/`.

This is the "burst browser" path: very low-latency follow-up commands once the browser is warm.

The required browser capabilities are:

- `snapshot -i` and `snapshot -C` for stable `@e` and `@c` refs
- annotated screenshots and responsive captures for visual evidence
- console, network, and dialog inspection for behavioral evidence
- health-checked daemon restart instead of PID trust
- `handoff` and `resume` for MFA, CAPTCHA, and complex auth recovery
- workspace-local state isolation via `.gstack/browse.json`

Reason:

- these are the concrete features that make the browser usable as a production verification runtime instead of just a screenshot helper
- they are already the fastest trustworthy path in the codebase
- Windows support is credible only if this exact feature set is part of the contract

### 3. Verification Plane: QA Functional Agents

`/qa` and related QA flows are promoted from "nice workflow skill" to "required verification subsystem."

The QA subsystem owns:

- route discovery
- interactive flow coverage
- screenshots before and after bugs
- console/network capture
- responsive checks
- baseline creation
- regression comparison
- ship-readiness scoring

When a plan-eng review exists, QA should consume its test artifact first.
When no artifact exists, QA falls back to route and interaction discovery in the browser.

The required QA operating modes are:

- Quick: homepage + top navigation smoke on every production-readiness pass
- Standard: broad route coverage plus bug documentation
- Exhaustive: visual, responsive, and medium/cosmetic coverage for release hardening
- Regression: compare against prior `baseline.json` and surface score deltas

The required QA behaviors are:

- every issue has screenshot evidence
- every real fix is re-verified
- regression tests are added when the bug has a clear codepath
- baseline artifacts are generated locally and retained for comparison

Reason:

- QA already contains the closest thing gstack has to an executable acceptance gate
- the mode structure matches how much confidence we want, not just how long we want to spend
- promoting these behaviors into the design removes ambiguity about what "production-ready" means

The required functional agents inside this subsystem are:

#### 3.1 Intent Shaper

Source: `/office-hours`

Owns:

- the user pain statement
- the narrowest valuable wedge
- the proof condition that QA must later verify

#### 3.2 Surface Scanner

Source: `browse` plus QA orient/explore phases

Owns:

- route discovery
- top-level navigation inventory
- initial annotated snapshots
- quick-mode fallback target selection

#### 3.3 Auth Agent

Source: QA authenticate phase plus `handoff` / `resume`

Owns:

- browser login strategy
- manual-auth escalation
- cookie JSON import when explicitly provided

This agent must not assume Windows browser-cookie decryption exists.

#### 3.4 Flow Runner

Source: `browse` command surface plus QA exploration loop

Owns:

- end-to-end interaction coverage
- console, dialog, and network checks during flows
- responsive and visual checks where the flow can regress layout

#### 3.5 Evidence Collector

Source: screenshots, snapshots, logs, and QA reporting conventions

Owns:

- before/after screenshots
- annotated issue evidence
- local report artifact completeness

#### 3.6 Triage and Fix Agent

Source: QA triage and fix loop

Owns:

- severity ranking
- fix/defer decisions by mode
- regression test creation when the bug has a stable codepath

#### 3.7 Final Verifier

Source: QA final QA phase

Owns:

- post-fix reruns
- health score delta
- release readiness summary

This split matters because it gives us parallelizable work packets instead of one vague
"run QA" step. It also makes the required artifacts and handoffs explicit.

### 4. Security Plane

Security boundaries are local and explicit:

- browser control only on localhost
- bearer token per browse session
- no secrets committed into generated skill metadata
- no promise of Windows browser-cookie decryption until DPAPI exists and is verified

For authenticated QA on Windows today, the safe order is:

1. manual login in the app
2. visible-browser handoff when needed
3. JSON cookie import if the team explicitly exports safe test cookies

Direct Windows Chromium cookie decryption is not a design dependency.

### 5. Artifact Plane

The required production artifacts are:

- `.agents/skills/*`
- `browse/dist/browse`
- `browse/dist/server-node.mjs`
- `.gstack/qa-reports/*`
- `.gstack/browse*.log`
- test baselines and screenshots

The artifact contract matters as much as the prompt contract. If Windows needs `server-node.mjs`, the build and setup must treat it as a first-class deliverable.

### 6. Distribution and Update Plane

Distribution must support both solo and team setups on Windows without WSL.

- Preferred for teams: repo-local install under `.agents/skills/gstack`
- Allowed for solo use: user-global install under `~/.codex/skills/gstack`
- Build must generate both the compiled browser binary and the Windows Node server bundle
- setup must refresh generated skills and replace stale Codex skill installs

Rollback rule:

- if a new build breaks Windows browse startup, the operator must be able to restore the previous `browse/dist/*` artifacts and rerun setup without changing hosts or requiring WSL

## What Changed and Why

### Change 1: API-first -> Codex-auth-first local control plane

Why:

- the real operating model is local Codex CLI usage
- API-key-first design adds configuration burden with no user value on this machine
- local auth is the path we can actually verify end to end

### Change 2: browse optional helper -> browse mandatory runtime

Why:

- the fastest path to trustworthy automation is the existing persistent browser
- QA, canary, benchmark, and authenticated checks all depend on it
- removing browse from the center would make production proof weaker, not stronger

### Change 3: QA as a report skill -> QA as the release gate and functional agent set

Why:

- production confidence comes from screenshots, logs, and reproducible flows
- `/qa` already encodes health scoring, regression baselines, and fix verification
- this is the closest thing the repo has to an executable acceptance test harness

### Change 4: macOS-biased auth assumptions -> Windows-safe auth strategy

Why:

- Windows DPAPI browser cookie import is still deferred
- promising automatic browser cookie extraction on Windows would make the design dishonest
- manual handoff and controlled cookie import are safer and currently operable

### Change 5: host-agnostic language -> explicit Windows/no-WSL constraints

Why:

- Bun's Playwright pipe issue on Windows is real
- the working solution is Node-hosted server runtime on Windows
- the design must name this constraint so setup, docs, and verification stay aligned

## Windows Contract

The design is valid only if all of these are true:

1. `bun` is installed
2. `node` is installed
3. Playwright Chromium can launch through Node
4. `browse/dist/server-node.mjs` is built and shipped
5. Codex CLI is logged in
6. setup can register Codex skills without WSL

If any of these fail, the system is not production-ready on Windows.

## Operational Rules

1. Treat `browse` startup on Windows as a product-critical path.
2. Treat `server-node.mjs` as required, not derived trivia.
3. Never require WSL for the supported path.
4. Never require raw OpenAI or Anthropic API keys for the primary Codex workflow.
5. Do not make Windows cookie decryption a prerequisite for QA.
6. Prefer repo-local installs for repeatable team setups.
7. Keep `.gstack/` local and gitignored at all times.
8. Never auto-commit screenshots, logs, or baselines unless the user explicitly asks.

## Failure and Recovery Model

### Browse failure

- If the browse server is unhealthy, the CLI should restart it automatically.
- If Windows startup fails, rebuild artifacts first, then rerun setup, then rerun the browser smoke test.
- If Chromium auth is blocked by CAPTCHA or MFA, switch to visible-browser handoff instead of forcing secret entry through the model.

### Codex failure

- If Codex cannot load skills, treat metadata freshness as a setup failure and rerun Codex setup.
- If review evals time out on very large diffs, record the timeout explicitly and require a smaller direct smoke or narrower review scope before claiming readiness.

### QA failure

- If `/qa` cannot produce screenshots or a baseline, the release gate is not satisfied.
- If `/qa` finds regressions that lower the final score versus baseline, do not claim production readiness.

## Production Verification Matrix

### Gate A: Build Integrity

- `bun run build`
- pass if `browse/dist/browse` and `browse/dist/server-node.mjs` both exist

### Gate B: Windows Browser Runtime

- launch the compiled `browse` binary on Windows
- navigate to a local fixture or local test page
- capture text or snapshot successfully

Pass criteria:

- the CLI auto-starts the local server
- Chromium launches
- a command returns usable output

### Gate C: Browser Regression Coverage

- `bun test browse/test/`

Pass criteria:

- core browse command suite passes on this machine

### Gate D: Codex Runtime

- `codex login status`
- `codex exec "Reply with exactly OK" --json -s workspace-write`

Pass criteria:

- authenticated Codex run succeeds
- skills load without empty metadata warnings

### Gate E: Codex Skill E2E

- `bun test test/codex-e2e.test.ts`

Pass criteria:

- discovery path works
- review path loads runtime assets and executes tool calls
- any timeout path is documented as an eval limitation, not hidden

### Gate F: QA Readiness

For a real app or fixture target:

- run a `/qa --quick` equivalent flow
- produce screenshots
- produce a report and baseline

Pass criteria:

- report artifacts are created
- screenshots are readable
- health score and findings are reproducible

## Recommended Parallel Agent Assignment

If you want to push this design through implementation and verification quickly, use these local agents in parallel:

### Agent 1: Design owner (`/office-hours`)

Instruction:

- "Treat `DESIGN.md` as the source of truth. Update the design when implementation reality changes. Keep the document Windows-first, Codex-first, and browser/QA-centered."

Why:

- this agent owns design coherence and prevents the repo from drifting back to vague API-first language

### Agent 2: Browser runtime owner (`/browse`)

Instruction:

- "Verify the Windows browse runtime on real targets. Prove daemon startup, snapshot refs, screenshots, console/network capture, and handoff/resume. Produce artifacts, not prose."

Why:

- this is the fastest way to catch the real Windows failures: startup, auth, stale refs, and browser state handling

### Agent 3: QA gate owner (`/qa`)

Instruction:

- "Run Quick first, then escalate to Standard or Regression as needed. Produce screenshots, a baseline, and a release-readiness score. If a bug is fixed, re-verify it and add a regression test when justified."

Why:

- this agent turns the browser into a repeatable acceptance gate instead of a one-off manual test

### Agent 4: Architecture gate (`/plan-eng-review`)

Instruction:

- "Review `DESIGN.md` plus the implementation diff. Challenge the control plane, Windows runtime path, artifact contract, failure recovery, and test coverage. Block anything that cannot be verified locally on Windows without WSL."

Why:

- this keeps the implementation honest about edge cases and operational boundaries

### Agent 5: Security gate (`/cso`)

Instruction:

- "Review `DESIGN.md` and the Windows runtime for localhost exposure, token handling, secrets, browser auth flow, telemetry, dependency supply chain, and any unsafe claims about Windows cookie handling."

Why:

- the biggest design risk here is overstating what is secure or supported on Windows; this agent prevents that

## Review Summary

### `/plan-eng-review` summary

Verdict: PASS WITH CONCERNS

What changed after review:

- the design now names PowerShell runtime and Git Bash setup as separate concerns instead of pretending Windows is one uniform shell path
- QA is now split into explicit functional agents so the handoff surfaces are reviewable
- the production gate now requires evidence artifacts, not just successful command execution

Remaining engineering concerns:

1. `server-node.mjs` must remain a required build output on Windows, not an incidental artifact.
2. Repo-local install should remain the preferred team path because it is the easiest configuration to reproduce.
3. Timeout-tolerant Codex evals still need a narrower smoke path before claiming "fully green" on very large diffs.

### `/cso` summary

Verdict: PASS WITH CONCERNS

What changed after review:

- the design now explicitly keeps Windows browser-cookie decryption out of the critical path
- security boundaries are expressed in terms of localhost, bearer-token auth, and local artifact handling
- manual auth handoff is treated as the safer fallback when automation would otherwise pressure secrets into model context

Remaining security concerns:

1. QA screenshots and logs can contain sensitive app data and must remain local by default.
2. Any future Windows DPAPI implementation must ship with dedicated verification before it is referenced in the main auth path.
3. Upstream Codex plugin-sync warnings should never be confused with local runtime compromise, but they should be documented during operations.

## Known Risks

1. Windows DPAPI cookie import is not implemented. The design avoids depending on it.
2. Large-diff Codex review evals may time out before the model finishes reasoning. This is an eval-shape problem, not a basic runtime failure.
3. Plugin sync and shell snapshot warnings from Codex CLI may appear even when the local workflow is healthy.
4. QA artifacts can contain sensitive application data on screen. They must remain local unless deliberately curated for sharing.

## Non-Goals

1. WSL-only workflows
2. mandatory remote browser services
3. mandatory direct API-key orchestration for the primary path
4. pretending Windows browser auth is solved when DPAPI is still missing

## Review Targets

The updated design should be accepted only if:

- Eng review agrees the control/execution/verification split is implementable
- Security review agrees the auth and secret boundaries are honest
- Windows verification gates all run on a real notebook without WSL
