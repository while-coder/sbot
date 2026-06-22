# Agents

Sidebar → **Agent Management** → New

An agent bundles a model, a system prompt, and the tools / skills / knowledge it can reach. You then assign the agent to chat sessions or channels.

## Agent Modes

### Single

Pick a model, write a system prompt, optionally attach MCP tools and skills. The default mode for focused single-purpose assistants.

### ReAct

Pick a **think model**, then add sub-agents (each with an id and description for task dispatch). The think model decomposes user requests and dispatches sub-tasks recursively; each sub-agent has read-only access to shared memory.

Use ReAct when:
- The task is open-ended ("plan and execute X end-to-end")
- You want the orchestrator to choose specialists dynamically

Each dispatched sub-task can inherit context from the parent conversation (`none` — clean start, the default; `state` — a bounded snapshot of recent parent messages; `full` — the full forked history). Recursion depth is guarded to prevent runaway nesting.

### Generative

Pick a multimodal model for mixed text + image content generation.

## Configuration

| Section | Purpose |
|---------|---------|
| Model | Primary LLM for this agent |
| System prompt | Persona, capabilities, response style |
| MCP tools | Per-agent enable list of [MCP servers](./mcp) |
| Skills | Per-agent [skill](./skills) selection (empty = load all) |
| Notes | Default [notes](./note) (vector store) for sessions using this agent |
| Wiki | Default [wiki/knowledge base](./wiki) for sessions |
| Memory | Per-agent long-term memory via background MemoryLLM — see [Memory](./memory) |
| Agenda | Per-agent reminders / schedules, optionally synced from the conversation — see [Agenda](./agenda) |
| Heartbeat | Periodic self-activation — see [Heartbeat](./heartbeat) |

## Pre-Built Agents

Want to skip the manual setup? Browse the [Agent Store](./agent-store) for ready-to-install bundles (model + prompt + tools + skills + MCP servers).
