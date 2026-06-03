# Insight

Agent edit page → **Insight** section

Insight is a silent post-turn extractor that runs after every conversation turn and distills durable knowledge — user preferences, project facts, lessons learned — into reusable Markdown notes. Relevant insights are auto-injected back into the system prompt on subsequent turns via hybrid keyword + semantic search.

Think of it as the agent learning from every conversation, without you having to teach it explicitly.

## How It Works

After each turn, the **extraction model** silently reviews the latest exchange and decides one of:

- **`create`** — a new durable fact worth remembering
- **`patch`** — update or refine an existing insight
- **`delete`** — invalidate an insight that turned out to be wrong
- **`skip`** — nothing extraction-worthy this turn

Insights are stored as `SKILL.md` files in `~/.sbot/insights/` (each scoped per agent or per session, depending on configuration).

## Configuration

| Field | Description |
|-------|-------------|
| Scope | `Disabled` / `Per Agent` (shared across all sessions of this agent) / `Per Session` (isolated per thread) |
| Extraction Model | Model used to run the post-turn extraction — typically a cheap, fast model |
| Extraction Prompt | Prompt file from `~/.sbot/prompts/insight/extractor/` controlling **what** to extract |

## Lifecycle

Insights age out automatically:

- **Stale** (default 30 days unused) — marked but still queryable
- **Archived** (default 90 days unused) — removed from active retrieval; archive kept on disk

This keeps the insight pool fresh without manual pruning.

## Insight vs Notes vs Wiki

| | Who writes? | When written? |
|---|-------------|---------------|
| [Insight](./insight) | Silent extractor agent | Post-turn, automatically |
| [Notes](./note) | The active agent | Mid-turn, via tool call when relevant |
| [Wiki](./wiki) | Humans (mostly) + agent | Curated; agent can also create/edit |

Insights are the most "set and forget" of the three.
