# Claude Code Agent Teams — Master Reference Guide

> **Purpose**: This guide helps Claude Code sessions build effective agent teams for the BESTCHOICE project. Reference this document before spawning any team.

---

## Table of Contents

1. [Overview](#overview)
2. [Configuration](#configuration)
3. [Agent Teams vs Subagents](#agent-teams-vs-subagents)
4. [Best Practices](#best-practices)
5. [Communication & Coordination](#communication--coordination)
6. [Hooks & Quality Gates](#hooks--quality-gates)
7. [Ideal Use Cases](#ideal-use-cases)
8. [Anti-Patterns](#anti-patterns)
9. [Limitations](#limitations)
10. [Token Cost Management](#token-cost-management)
11. [BESTCHOICE Project Templates](#bestchoice-project-templates)
12. [Commands & Keyboard Shortcuts](#commands--keyboard-shortcuts)

---

## Overview

Agent teams coordinate **multiple independent Claude Code instances** working together on a shared project.

### Architecture

| Component | Role |
|-----------|------|
| **Team Lead** | Main session that creates the team, spawns teammates, assigns tasks, synthesizes results |
| **Teammates** | Separate Claude Code instances with full tool access and independent context windows |
| **Task List** | Shared work items teammates claim and complete (stored in `~/.claude/tasks/{team-name}/`) |
| **Mailbox** | Messaging system for direct inter-agent communication |

**Key difference from subagents**: Teammates can message each other directly and have fully independent context windows. Subagents only report back to their caller.

---

## Configuration

### Enable Agent Teams

In `.claude/settings.json` (already configured for this project):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Or via shell: `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

### Display Modes

Set via `teammateMode` in settings.json:

| Mode | Description | Requirements |
|------|-------------|--------------|
| **`auto`** (default) | Split panes if available, in-process otherwise | Auto-detects |
| **`in-process`** | All teammates in main terminal | Any terminal |
| **`tmux`** | Each teammate in its own tmux pane | tmux installed |

**Split-pane mode is NOT supported in**: VS Code integrated terminal, Windows Terminal, Ghostty.

### Command-line Override

```bash
claude --teammate-mode in-process
```

---

## Agent Teams vs Subagents

| Aspect | Subagents | Agent Teams |
|--------|-----------|-------------|
| **Context** | Own window; results return to caller | Own window; fully independent |
| **Communication** | Report back to main agent only | Message each other directly |
| **Coordination** | Main agent manages all work | Shared task list, self-coordination |
| **Architecture** | Within single session | Multiple separate instances |
| **Token cost** | Lower (results summarized) | ~7x higher than single session |
| **Best for** | Focused tasks needing only results | Complex parallel work requiring collaboration |

### Decision Guide

**Use subagents when:**
- Task is focused and results-only (research, file search, verification)
- Work fits in a single context window
- No inter-worker communication needed
- Cost efficiency matters

**Use agent teams when:**
- Multiple areas of code need parallel changes
- Workers need to discuss and coordinate
- Competing hypotheses need independent investigation
- Task requires 3+ parallel workstreams with different expertise

---

## Best Practices

### Team Sizing

- **Start with 3-5 teammates** for most workflows
- **5-6 tasks per teammate** keeps everyone productive
- More teammates = more coordination overhead + higher token cost
- Fewer is usually better — only add teammates when the parallelism genuinely helps

### Task Design

- **Self-contained units**: Each task should produce a clear deliverable (a function, test file, API endpoint)
- **Avoid file conflicts**: Break work so each teammate owns different files. Two teammates editing the same file leads to overwrites
- **Right-size tasks**: Too small = coordination overhead exceeds benefit. Too large = teammates work too long without check-ins
- **Let the lead create tasks**: The lead automatically breaks work into granular items

### Spawn Prompts

Give teammates enough context in the spawn prompt — they do NOT inherit the lead's conversation history.

**Good spawn prompt:**
```
Create an agent team to implement the new payment reconciliation feature.
Spawn three teammates:
- "backend" focused on the NestJS API endpoints and Prisma queries in apps/api
- "frontend" focused on the React components and pages in apps/web
- "tester" focused on writing Playwright E2E tests in apps/web/e2e
Each teammate should read CLAUDE.md for project conventions.
```

**Bad spawn prompt:**
```
Make a team to work on the feature we discussed.
```
(No context — teammates have no idea what "the feature" is)

### Delegation

- **Wait for teammates to finish**: Tell the lead "Wait for your teammates to complete their tasks before proceeding"
- **Monitor progress**: Check in on teammates, redirect failing approaches
- **Don't let teams run unattended**: Increases risk of wasted effort and token burn

---

## Communication & Coordination

### How Context is Shared

Each teammate automatically receives:
- Project context (CLAUDE.md, MCP servers, skills)
- Spawn prompt from lead

Each teammate does **NOT** receive:
- Lead's conversation history
- Other teammates' conversation history

### Messaging

```
message <teammate-name> <message>   # Send to specific teammate
broadcast <message>                  # Send to all (use sparingly — costs scale)
```

- Messages are delivered automatically (no polling)
- Teammates get idle notifications when they finish work
- Task dependencies are managed automatically — completed tasks unblock dependent ones

### Task Claiming

- Lead assigns tasks explicitly, or teammates self-claim after finishing
- File locking prevents race conditions on task claiming
- Task states: pending → in progress → completed

---

## Hooks & Quality Gates

Configure hooks in `.claude/settings.json` for automated quality enforcement:

```json
{
  "hooks": {
    "TeammateIdle": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Teammate idle - checking work quality'"
          }
        ]
      }
    ],
    "TaskCompleted": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "npm run lint && npm run typecheck"
          }
        ]
      }
    ]
  }
}
```

### Hook Behavior

| Exit Code | Effect |
|-----------|--------|
| **0** | Success, continue normally |
| **2** | Send feedback to teammate, keep them working |
| **JSON `{"continue": false, "stopReason": "..."}`** | Stop teammate entirely |

---

## Ideal Use Cases

### Strong Use Cases

**1. Parallel Code Review**
```
Create an agent team to review PR #142. Spawn three reviewers:
- One focused on security implications
- One checking performance impact
- One validating test coverage
Have them each review and report findings.
```

**2. Competing Hypotheses / Bug Investigation**
```
Users report the app crashes after payment submission.
Spawn 4 teammates to investigate different hypotheses:
- Payment API response handling
- State management race condition
- Network timeout handling
- Database transaction failure
Have them discuss and disprove each other's theories.
```

**3. Multi-Layer Feature Implementation**
```
Implement the new stock transfer feature:
- "api" teammate: NestJS controller, service, and Prisma queries
- "web" teammate: React pages and components
- "test" teammate: Playwright E2E tests
- "migration" teammate: Prisma schema changes and seed data
```

**4. Cross-Layer Coordination**
Changes spanning frontend, backend, tests, and database — each teammate owns their layer and coordinates through the shared task list.

### Moderate Use Cases

- Large refactoring across multiple modules
- Documentation updates across different sections
- Setting up new project infrastructure

### Weak Use Cases (use single session or subagents instead)

- Sequential tasks with many dependencies
- Small, focused tasks (overhead not justified)
- Heavy file conflicts (multiple teammates editing same files)
- Routine maintenance

---

## Anti-Patterns

| Anti-Pattern | Why It's Bad | Instead |
|---|---|---|
| **Too many teammates** (>5) | Coordination overhead dominates, token burn | Start with 3, add if needed |
| **Overlapping file ownership** | Teammates overwrite each other's changes | Assign clear file boundaries |
| **Vague spawn prompts** | Teammates waste tokens exploring blindly | Include specific files, goals, and context |
| **Unattended teams** | Wasted effort compounds, wrong approaches go unchecked | Monitor and steer |
| **Tiny tasks** | Coordination cost > task cost | Batch into meaningful units |
| **Lead implementing instead of waiting** | Duplicates teammate work | Tell lead to wait for teammates |
| **Broadcasting everything** | Token cost scales with team size per message | Direct message specific teammates |
| **Not cleaning up** | Idle teammates still consume tokens | Clean up team when done |

---

## Limitations

| Limitation | Impact | Workaround |
|---|---|---|
| **No session resumption** for in-process teammates | `/resume` won't restore teammates | Spawn new teammates after resuming |
| **No nested teams** | Teammates can't spawn their own teams | Only lead manages the team |
| **Fixed lead** | Can't promote a teammate to lead | Plan team structure upfront |
| **Task status can lag** | Teammates may not mark tasks completed | Manually check and nudge |
| **Slow shutdown** | Teammates finish current tool call before stopping | Plan for graceful shutdown time |
| **One team per session** | Must clean up before starting a new team | Clean up explicitly between teams |
| **Permissions set at spawn** | All teammates start with lead's permissions | Change individual modes after spawning |
| **Teammates may stop on errors** | Can halt instead of recovering | Give instructions or spawn replacement |

---

## Token Cost Management

Agent teams use **significantly more tokens** than single sessions — roughly **7x** with teammates in plan mode.

### Cost Reduction Strategies

1. **Use Sonnet for teammates** when full Opus capability isn't needed
2. **Keep teams small** — token usage is proportional to team size
3. **Keep spawn prompts focused** — everything adds to initial context
4. **Clean up teams when done** — idle teammates continue consuming tokens
5. **Size tasks appropriately** — avoid many small tasks with high coordination overhead
6. **Be specific in prompts** — vague requests trigger broad scanning
7. **Monitor with `/cost`** — check token usage during the session

---

## BESTCHOICE Project Templates

### Template 1: Full-Stack Feature Implementation

```
Create an agent team to implement [FEATURE_NAME]:

Spawn 3 teammates:
- "api": NestJS backend in apps/api — controller, service, Prisma queries.
  Key files: apps/api/src/modules/
- "web": React frontend in apps/web — pages, components, API integration.
  Key files: apps/web/src/pages/, apps/web/src/components/
- "e2e": Playwright E2E tests in apps/web/e2e/.
  Reference existing tests for patterns (mock-auth helper, loginWithMock).

All teammates should read CLAUDE.md for conventions.
API teammate should finish endpoints before web teammate starts API integration.
E2E teammate should wait for web teammate to finish pages before writing tests.
```

### Template 2: PR Review Team

```
Create an agent team to review PR #[NUMBER]:

Spawn 3 reviewers:
- "security": Check for XSS, SQL injection, auth bypass, OWASP top 10.
  Focus on API routes and input handling.
- "quality": Check code quality, TypeScript types, error handling,
  Prisma query efficiency, React component patterns.
- "tests": Verify test coverage, check E2E test reliability,
  ensure no hardcoded waits (use waitForLoadState/waitFor instead).

Have each reviewer report findings. Lead synthesizes into review comments.
```

### Template 3: Bug Investigation

```
Create an agent team to investigate [BUG_DESCRIPTION]:

Spawn 4 teammates:
- "frontend": Check React components, state management, API calls in apps/web
- "backend": Check NestJS services, Prisma queries, auth middleware in apps/api
- "database": Check Prisma schema, migrations, indexes, query performance
- "infra": Check Vite proxy config, environment variables, Docker setup

Have them discuss findings and disprove each other's theories.
Lead synthesizes the root cause and proposes a fix.
```

### Template 4: Refactoring

```
Create an agent team to refactor [MODULE]:

Spawn 3 teammates:
- "refactor": Make the actual code changes across apps/api and apps/web
- "tests": Update existing tests and add new ones for changed behavior
- "verify": Run the test suite continuously and report failures to the team

Refactor teammate should make small, incremental changes.
Verify teammate should run tests after each change batch.
```

---

## Commands & Keyboard Shortcuts

### In-Process Mode

| Shortcut | Action |
|----------|--------|
| `Shift+Down` | Cycle forward through teammates |
| `Shift+Up` | Cycle backward through teammates |
| `Escape` | Interrupt teammate's current turn |
| `Ctrl+T` | Toggle task list view |
| Type text | Send message to focused teammate |

### Split-Pane Mode (tmux/iTerm2)

- Click into a teammate's pane to interact directly
- Standard tmux keybindings apply for pane navigation

### Team Management

```
"Clean up the team"                          # Shutdown all teammates
"Ask [name] teammate to shut down"           # Shutdown specific teammate
"Wait for teammates to complete"             # Prevent lead from proceeding early
"Assign [task] to [teammate]"                # Explicit task assignment
"Check on [teammate]'s progress"             # Status check
```

---

## Quick Decision Flowchart

```
Need parallel work?
├── No → Use single session or subagent
└── Yes
    ├── Workers need to talk to each other?
    │   ├── No → Use multiple subagents
    │   └── Yes → Use agent team
    ├── >2 files being edited simultaneously?
    │   ├── Same files → DON'T use agent team (conflict risk)
    │   └── Different files → Agent team works well
    └── Task duration?
        ├── <5 min each → Subagents (less overhead)
        └── >5 min each → Agent team (worth the coordination cost)
```
