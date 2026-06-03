# Agent Store

Sidebar → **Agent Store**

The Agent Store lets you browse and one-click install pre-packaged agents from configurable registries. Each package bundles model selection, system prompt, skills, and MCP server configuration — saving the manual setup walkthrough.

## Installing

1. Open **Agent Store** in the sidebar
2. Browse / search packages
3. Click **Install** — sbot:
   - Adds the agent to **Agent Management**
   - Pulls in any required [skills](./skills) it doesn't already have
   - Adds any [MCP servers](./mcp) it depends on (with placeholders for missing API keys)
4. Open the installed agent and fill in any missing credentials (API keys, MCP env vars)

Installed agents are normal agents — you can edit, fork, or delete them like any hand-built one.

## Adding Custom Registries

Sidebar → **Settings** → Agent Store registries

Add custom registry URLs to pull from your own catalog (team-internal agents, private bundles).

A registry is a JSON manifest listing available packages, served over HTTPS. The exact schema is documented in the project repo.

## Authoring a Package

A package is a JSON document with:

- Display metadata (name, description, icon, tags)
- Default model + system prompt
- Required / suggested skills
- Required MCP servers + env-var placeholders

Once published to a registry, anyone pointing sbot at that registry can install it with one click.
