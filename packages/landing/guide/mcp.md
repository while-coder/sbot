# MCP Tools

Sidebar → **MCP** → New

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) enables agents to use external tools via a standard protocol.

## Adding a Server

- **stdio** — command + args (e.g. `npx -y some-mcp-package`)
- **http** — remote URL + optional headers

## Configuration

- Supports global servers shared across all agents and per-agent overrides
- Servers auto-restart on failure
- Open an agent → MCP tab to attach the servers you want it to use

## Usage

Once attached to an agent, MCP tools are available during conversations. The agent can discover and call tools provided by the MCP server automatically.
