# Agents

Sidebar → **Agents** → New

## Agent Modes

### Single

Select a model, write a system prompt, optionally attach MCP tools and skills. Best for focused single-purpose assistants.

### ReAct

Select a think model, then add sub-agents (each with an id and description for task dispatch). The think model decomposes tasks and dispatches sub-tasks recursively; each sub-agent has read-only access to shared memory.

### Generative

Select a multimodal model for mixed text and image content generation.

## Configuration

- **System prompt** — Define the agent's personality and behavior
- **MCP tools** — Attach tool servers for extended capabilities
- **Skills** — Load specific skills or leave empty to load all
- **Memory** — Assign memory for long-term context
- **Wiki** — Assign knowledge base for reference
