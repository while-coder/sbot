# Memory

Sidebar → **Memory Profiles** (under **Tasks**), then enable it per-agent in the agent edit page → **Memory**.

Memory is the agent's automatic long-term memory. A background **MemoryLLM** reviews each conversation after it goes idle and distills durable knowledge — user preferences, project facts, decisions, lessons learned — into memory entries. On later turns the agent reads them back via the `search_memory` and `read_memory` tools.

Think of it as the agent learning from every conversation without you having to teach it explicitly — and without bloating the system prompt.

## How It Works

1. **Extract** — after a conversation idles, the **writer model** silently reviews the exchange and writes new memories (or updates/removes existing ones).
2. **Read** — on subsequent turns the agent calls:
   - `search_memory` — fuzzy/keyword/semantic lookup across stored memories
   - `read_memory` — fetch the full body of a memory by its slug
3. **Maintain** — background jobs keep the store healthy:
   - **Consolidate** — merges and de-duplicates related memories
   - **Reconcile** — re-indexes and prunes stale entries
4. **Delete** — removed memories are moved to `.archive/` and can be recovered.

## Configuration

A **Memory Profile** defines how memories are extracted and read. Sidebar → **Memory Profiles** → New:

| Field | Description |
|-------|-------------|
| Name | Display name for this profile |
| Enabled | Pause the profile without deleting it |
| Writer Model | The MemoryLLM used to extract memories (a reasoning-capable model recommended) |
| Writer Prompt | Controls **what** gets extracted |
| Read Prompt | How retrieved memories are formatted back into the prompt |

Then, in an agent → **Memory** section, toggle Memory on and pick the profile. From the Memory Profiles page you can **View Memories**, inspect pending/failed background jobs, **Run Extract** to wake the queued extractor, **Consolidate** to queue cleanup, and **Reconcile** to rescan files and indexes.

## Memory vs Notes vs Wiki

| | Who writes? | When written? |
|---|-------------|---------------|
| [Memory](./memory) | Background MemoryLLM | After the conversation idles, automatically |
| [Notes](./note) | Humans / operators | Manually, then recalled automatically or via `note_search` |
| [Wiki](./wiki) | Humans / wiki source plugins | Curated pages, then searched/read by agents |

Memory is the most "set and forget" of the three.
