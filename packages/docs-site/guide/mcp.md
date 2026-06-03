# MCP Tools

Sidebar → **Tools** → New

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) lets agents call external tools through a standard protocol. sbot supports both stdio and SSE transports, with global servers shared across all agents and per-agent overrides.

## Adding a Server

- **stdio** — command + args (e.g. `npx -y some-mcp-package`); environment variables can be configured per server
- **sse** — remote URL + optional headers (for hosted MCP services)

## Configuration

- **Global servers** — shared across every agent
- **Per-agent overrides** — open an agent → MCP tab → enable specific servers
- **Auto-restart** — failed stdio servers are automatically respawned
- **Lazy start** — servers boot only when an agent that uses them runs

## Usage

Once attached to an agent, MCP tools are advertised to the model on every turn. The agent discovers available tools and calls them automatically; tool results are fed back into the conversation.

## Tips

- For local commands that need a Node toolchain, use the `npx -y` form to avoid pre-install hassle
- Use SSE transport when the MCP server is remote or shared across multiple sbot instances
- Sensitive secrets in env vars are masked in logs
