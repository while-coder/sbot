# MCP Tools

Sidebar → **Tools** → New

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) lets agents call external tools through a standard protocol. sbot supports stdio, HTTP, and SSE transports, with built-in presets, global servers shared across agents, and per-agent servers.

## Adding a Server

- **stdio** — command + args (e.g. `npx -y some-mcp-package`); environment variables can be configured per server
- **http** — remote MCP endpoint URL + optional headers
- **sse** — remote URL + optional headers (for hosted MCP services)

## Configuration

- **Built-in presets** — Playwright, Markitdown, Exa, and local built-in tool groups are listed from the same MCP screen
- **Global servers** — shared across every agent
- **Per-agent servers** — open an agent → MCP tab to enable global providers or add agent-only MCP servers
- **Auto-restart** — failed stdio servers are automatically respawned
- **Lazy start** — servers boot only when an agent that uses them runs
- **Tool timeout** — override the per-call timeout for slow tools
- **Prompt / Resource tools** — optionally expose MCP prompts and resources through generated helper tools

## Usage

Once attached to an agent, MCP tools are advertised to the model on every turn. The Web UI can inspect a provider's tools, prompts, resources, and resource templates, and tool results are fed back into the conversation.

## Tips

- For local commands that need a Node toolchain, use the `npx -y` form to avoid pre-install hassle
- Use SSE transport when the MCP server is remote or shared across multiple sbot instances
- Sensitive secrets in env vars are masked in logs
