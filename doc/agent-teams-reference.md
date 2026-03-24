# Agent Teams — Master Reference Guide

> Source: https://code.claude.com/docs/en/agent-teams
> Requires: Claude Code v2.1.32+, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

---

## Table of Contents

1. [What Are Agent Teams?](#1-what-are-agent-teams)
2. [Agent Teams vs Subagents](#2-agent-teams-vs-subagents)
3. [Architecture](#3-architecture)
4. [Enabling Agent Teams](#4-enabling-agent-teams)
5. [Starting a Team](#5-starting-a-team)
6. [Controlling a Team](#6-controlling-a-team)
7. [Display Modes](#7-display-modes)
8. [Task Management](#8-task-management)
9. [Communication Patterns](#9-communication-patterns)
10. [Permissions & Context](#10-permissions--context)
11. [Best Practices](#11-best-practices)
12. [Use Case Playbook](#12-use-case-playbook)
13. [Hooks for Quality Gates](#13-hooks-for-quality-gates)
14. [Token Cost Awareness](#14-token-cost-awareness)
15. [Troubleshooting](#15-troubleshooting)
16. [Known Limitations](#16-known-limitations)
17. [Quick Decision Guide](#17-quick-decision-guide)

---

## 1. What Are Agent Teams?

An agent team is a **coordinated group of independent Claude Code sessions** working together. One session is the **team lead** — it creates the team, spawns teammates, manages the task list, and synthesizes results. Each **teammate** is a fully separate Claude instance with its own context window.

Key differentiator from subagents: **teammates can talk to each other directly** without going through the lead. You can also interact with individual teammates directly, bypassing the lead.

**When they shine:**
- Tasks where parallel exploration genuinely saves time
- Work that benefits from multiple perspectives or competing hypotheses
- Modules/features that are logically independent (no shared file writes)
- Cross-layer changes (frontend + backend + tests, each owned separately)

**When to avoid them:**
- Sequential tasks with hard dependencies
- Work requiring edits to the same file from multiple agents
- Simple, focused tasks where coordination overhead isn't worth it
- Tight token budgets

---

## 2. Agent Teams vs Subagents

| Dimension | Subagents | Agent Teams |
|---|---|---|
| **Context** | Own window; results return to caller | Own window; fully independent |
| **Communication** | Report back to main agent only | Teammates message each other directly |
| **Coordination** | Main agent manages everything | Shared task list + self-coordination |
| **Best for** | Focused tasks where only the result matters | Complex work needing discussion & collaboration |
| **Token cost** | Lower — results summarized back | Higher — each teammate is a full Claude instance |
| **Inter-agent debate** | Not possible | Supported (teammates challenge each other) |

**Rule of thumb:** Use subagents when workers only need to return a result. Use agent teams when workers need to share findings and coordinate on their own.

---

## 3. Architecture

```
Team Lead (main session)
├── Shared Task List  ──────────────────────────────────┐
├── Mailbox (messaging system)                          │
├── Teammate A ──────── claims tasks ──────────────────►│
│     └── messages Teammate B directly                  │
├── Teammate B ──────── claims tasks ──────────────────►│
│     └── messages Teammate A directly                  │
└── Teammate C ──────── claims tasks ──────────────────►│
```

**Storage locations:**
- Team config: `~/.claude/teams/{team-name}/config.json`
- Task list: `~/.claude/tasks/{team-name}/`

The config's `members` array holds each teammate's name, agent ID, and agent type — teammates can read this to discover peers.

**Task states:** `pending` → `in progress` → `completed`
Tasks with unresolved dependencies stay blocked until those dependencies complete. File locking prevents race conditions when multiple teammates claim the same task.

---

## 4. Enabling Agent Teams

Project-level (committed to repo — already done in this project):

```json
// .claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Or in your shell environment:

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

---

## 5. Starting a Team

Simply describe the task and team structure in natural language:

```
Create an agent team with 3 teammates to explore this problem:
- One focused on [aspect A]
- One focused on [aspect B]
- One playing devil's advocate
```

Claude will:
1. Create the team and shared task list
2. Spawn teammates with appropriate prompts
3. Coordinate work
4. Attempt cleanup when finished

**Claude can also propose a team** if it determines your task benefits from parallel work. You must confirm before it proceeds — Claude never creates a team without your approval.

---

## 6. Controlling a Team

All control goes through natural language to the lead. Key commands:

| Intent | Example prompt |
|---|---|
| Set team size & model | `"Create a team with 4 teammates. Use Sonnet for each."` |
| Require plan approval | `"Spawn an architect teammate. Require plan approval before any changes."` |
| Wait for teammates | `"Wait for your teammates to complete their tasks before proceeding."` |
| Assign a task | `"Assign the auth module refactor to the backend teammate."` |
| Shut down one teammate | `"Ask the researcher teammate to shut down."` |
| Clean up team | `"Clean up the team."` |

**Plan approval flow:**
1. Teammate works in read-only mode until plan is approved
2. Lead reviews and approves or rejects with feedback
3. If rejected, teammate revises and resubmits
4. Once approved, teammate exits plan mode and implements

Influence the lead's approval criteria in your prompt:
```
"Only approve plans that include test coverage. Reject plans that modify the database schema."
```

**Cleanup warning:** Always use the lead to clean up. If teammates are still running, cleanup fails — shut them down first. Teammates should never run cleanup themselves.

---

## 7. Display Modes

| Mode | How it works | When to use |
|---|---|---|
| `auto` (default) | Split panes if inside tmux, in-process otherwise | Default |
| `in-process` | All teammates in your main terminal; Shift+Down to cycle | Any terminal, no setup |
| `tmux` | Each teammate in its own pane; auto-detects tmux or iTerm2 | When you want all output visible at once |

**Override in settings:**

```json
{ "teammateMode": "in-process" }
```

**Override for one session:**

```bash
claude --teammate-mode in-process
```

**Navigation (in-process mode):**
- `Shift+Down` — cycle through teammates
- `Enter` on a teammate — view their session
- `Escape` — interrupt their current turn
- `Ctrl+T` — toggle task list

**Split pane requirements:**
- tmux: `brew install tmux` or system package manager
- iTerm2: install `it2` CLI + enable Python API in iTerm2 → Settings → General → Magic

---

## 8. Task Management

Tasks are created by the lead and claimed by teammates. Self-claiming is automatic: after finishing a task, a teammate picks the next unassigned, unblocked task.

**Sizing tasks correctly:**

| Size | Problem |
|---|---|
| Too small | Coordination overhead exceeds benefit |
| Too large | Long runs without check-ins; wasted effort risk |
| Just right | Self-contained unit with a clear deliverable (a function, test file, or review) |

**Practical sizing:**
- Target **5-6 tasks per teammate**
- If the lead isn't creating enough tasks, ask it to split work into smaller pieces
- If a task appears stuck, check if the work is actually done and manually update or tell the lead to nudge the teammate

---

## 9. Communication Patterns

**Teammate → Teammate (direct message):**

```
"Message the security reviewer teammate and ask them to also check for CSRF vulnerabilities."
```

**Teammate → All (broadcast):**

```
"Have the lead broadcast the current findings to all teammates."
```

Use broadcast sparingly — token costs scale with team size.

**Message delivery is automatic** — the lead doesn't poll. Teammates notify the lead automatically when they go idle.

**Encouraging debate (competing hypotheses pattern):**

```
"Spawn 5 teammates to investigate different root cause hypotheses.
Have them actively try to disprove each other's theories, like a scientific debate."
```

This fights anchoring bias — the theory that survives adversarial challenge is far more likely to be correct.

---

## 10. Permissions & Context

**Permissions:**
- Teammates inherit the lead's permission settings at spawn time
- If lead uses `--dangerously-skip-permissions`, all teammates do too
- You can change individual teammate modes after spawning, but not at spawn time

**What each teammate loads:**
- CLAUDE.md files from working directory ✅
- MCP servers ✅
- Skills ✅
- The spawn prompt from the lead ✅
- Lead's conversation history ✗ (not inherited)

**Providing task-specific context in the spawn prompt:**

```
Spawn a security reviewer with this prompt:
"Review src/auth/ for vulnerabilities. Focus on token handling, session management,
and input validation. The app uses JWT in httpOnly cookies. Rate issues by severity."
```

Don't rely on teammates knowing conversation history — put everything they need in the spawn prompt.

---

## 11. Best Practices

### Team size
- **Start with 3-5 teammates** for most workflows
- Scale up only when the work genuinely parallelizes
- Three focused teammates often outperform five scattered ones
- Token costs scale linearly with active teammates

### Avoid file conflicts
- Each teammate should own a distinct set of files
- Never have two teammates editing the same file
- Break work at file or module boundaries, not line boundaries

### Give enough context in spawn prompts
- Include file paths, relevant architecture details, constraints
- State the deliverable clearly
- Don't assume teammates know what the lead knows

### Monitor and steer
- Check in on progress; don't let teams run unattended too long
- Redirect approaches that aren't working early
- Synthesize findings as they come in, not just at the end

### Start simple
- First team? Use research/review tasks (no code writing)
- Clear boundaries, no conflicts, easy to verify
- Then move to parallel implementation once you're comfortable

### Forcing lead to wait
If the lead starts implementing instead of delegating:
```
"Wait for your teammates to complete their tasks before proceeding."
```

---

## 12. Use Case Playbook

### Parallel Code Review

Split review criteria into independent domains so each gets full attention:

```
Create an agent team to review PR #142. Spawn three reviewers:
- One focused on security implications
- One checking performance impact
- One validating test coverage
Have them each review and report findings.
```

### Debugging with Competing Hypotheses

Force adversarial investigation to avoid anchoring on one theory:

```
Users report the app exits after one message instead of staying connected.
Spawn 5 agent teammates to investigate different hypotheses. Have them talk to
each other to try to disprove each other's theories, like a scientific debate.
Update the findings doc with whatever consensus emerges.
```

### Cross-Layer Feature Implementation

Each teammate owns a separate layer:

```
Implement the new payment webhook feature. Create a team:
- Backend teammate: API endpoints and business logic in apps/api/
- Frontend teammate: UI components and hooks in apps/web/
- Test teammate: E2E tests in apps/web/e2e/ and unit tests
Coordinate so no teammate edits the other's files.
```

### Research & Architecture Exploration

Multiple perspectives before committing to a design:

```
I'm designing a CLI tool for tracking TODO comments. Create an agent team:
- UX teammate: explore developer experience and interface design
- Architecture teammate: technical design and data modeling
- Devil's advocate: challenge assumptions and find weaknesses
Synthesize findings into a design doc.
```

### New Module Development

Teammates own independent modules with clear interfaces:

```
Build the reporting module (apps/api/src/reports/).
Spawn teammates for:
- Data aggregation service
- Report generation logic
- Export formatters (PDF, CSV)
Each teammate works in their own subdirectory. Define interfaces first.
```

---

## 13. Hooks for Quality Gates

Two hooks specifically designed for agent teams:

### `TeammateIdle`

Runs when a teammate is about to go idle. Exit with code 2 to send feedback and keep them working.

```json
{
  "hooks": {
    "TeammateIdle": [{
      "hooks": [{
        "type": "command",
        "command": "your-quality-check-script.sh"
      }]
    }]
  }
}
```

Use case: automatically verify a teammate's output meets standards before they stop.

### `TaskCompleted`

Runs when a task is being marked complete. Exit with code 2 to block completion and send feedback.

```json
{
  "hooks": {
    "TaskCompleted": [{
      "hooks": [{
        "type": "command",
        "command": "your-task-validation-script.sh"
      }]
    }]
  }
}
```

Use case: enforce that tasks include tests, docs, or meet other criteria before being marked done.

---

## 14. Token Cost Awareness

- **Each teammate = a full, separate Claude instance** with its own context window
- Token costs scale **linearly** with active teammates
- Broadcast messages multiply costs by team size

**Cost-effective patterns:**
- Use agent teams only when parallelism genuinely saves time
- Prefer 3 focused teammates over 5 scattered ones
- Shut down teammates as soon as their work is done
- Use subagents for quick, focused tasks that only return a result

**Cost-heavy patterns to avoid:**
- Frequent broadcasts to all teammates
- Keeping idle teammates alive
- Spawning more teammates than tasks warrant

---

## 15. Troubleshooting

| Problem | Fix |
|---|---|
| Teammates not appearing | Press Shift+Down — they may already be running. Check task complexity (Claude may not have spawned a team). Verify tmux is in PATH: `which tmux` |
| Too many permission prompts | Pre-approve common operations in permission settings before spawning |
| Teammate stopped on error | Check output with Shift+Down, give direct instructions, or spawn a replacement |
| Lead shuts down before work is done | Tell it to keep going; add "wait for teammates" to future prompts |
| Orphaned tmux sessions | `tmux ls` then `tmux kill-session -t <session-name>` |
| Task appears stuck | Check if work is actually done; manually update status or tell lead to nudge the teammate |

---

## 16. Known Limitations

| Limitation | Impact | Workaround |
|---|---|---|
| No session resumption for in-process teammates | `/resume` and `/rewind` don't restore teammates | Spawn new teammates after resuming |
| Task status can lag | Blocked tasks may not unblock automatically | Manually update or nudge via lead |
| Slow shutdown | Teammates finish current request before stopping | Plan for this in time-sensitive workflows |
| One team per session | Lead can only manage one team | Clean up before starting a new team |
| No nested teams | Teammates can't spawn their own teams | All team management must go through lead |
| Lead is fixed | Can't promote a teammate to lead | Structure who is lead from the start |
| Permissions set at spawn | Can't set per-teammate modes at spawn time | Change modes after spawning individually |
| Split panes: limited terminal support | No VS Code integrated terminal, Windows Terminal, Ghostty | Use in-process mode for unsupported terminals |

---

## 17. Quick Decision Guide

```
Task requires parallel work?
│
├── No → Single session or subagents
│
└── Yes
    │
    ├── Workers need to talk to each other?
    │   ├── No → Subagents (cheaper, simpler)
    │   └── Yes → Agent teams
    │
    ├── Same files being edited?
    │   ├── Yes → Don't use agent teams (file conflicts)
    │   └── No → Agent teams OK
    │
    ├── Sequential dependencies?
    │   ├── Many → Single session (coordination overhead too high)
    │   └── Few → Agent teams with task dependencies
    │
    └── Team size?
        ├── 3-5 teammates → Sweet spot for most tasks
        ├── <3 → Consider if overhead is worth it
        └── >5 → Only if tasks are truly independent and plentiful
```

**Teammate count formula:** `ceil(task_count / 5)` — aim for ~5 tasks per teammate.

---

*Last updated from official docs: 2026-03-24*
*Source: https://code.claude.com/docs/en/agent-teams*
