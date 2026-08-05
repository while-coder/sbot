# Agenda

Sidebar → **Agenda Profiles** (under **Tasks**), then enable it per-agent in the agent edit page → **Agenda**.

Agenda is sbot's stateful reminder / scheduling system. Each agenda **item** (a todo, reminder, schedule, routine, or future automation) carries one or more **triggers**; when a trigger fires, sbot delivers a message to the session or channel the item is bound to.

Unlike [Heartbeat](./heartbeat) (a fixed-interval prompt loop) the agenda is *content-driven*: items can be created by the agent during a conversation, and — with a sync model configured — kept in sync automatically after every turn.

## Items & Triggers

An agenda **item** has a content, category, priority, optional due date, and a completion mode. Each **trigger** fires on a schedule:

| Trigger kind | `expr` meaning | Example |
|--------------|----------------|---------|
| `absolute` | A single ISO datetime — fires once | `2026-07-01T09:00` |
| `interval` | Milliseconds between fires | `86400000` (every 24h) |
| `cron` | 6-field cron (`sec min hour day month weekday`) | `0 0 9 * * 1-5` (9am weekdays) |

When a trigger fires it delivers its `message` to the bound session/channel using its `action` mode, and the fire is recorded in the `trigger_fire` log table (pure audit, not used for scheduling). A one-shot or finite schedule that reaches normal exhaustion becomes **Done**. A one-shot `absolute` trigger retries briefly on delivery failure; if it misses the grace window or gives up retrying, it is disabled and the item becomes **Expired** only when no other trigger on that item remains enabled. Expired items are retained as history rather than automatically deleted.

## Configuration

An **Agenda Profile** is the store + optional auto-sync. Sidebar → **Agenda Profiles** → New:

| Field | Description |
|-------|-------------|
| Name | Display name for this profile |
| Enabled | Pause the profile without deleting it |
| Sync Model | Optional. The model that auto-syncs agenda items from the conversation after each turn (leave empty to disable sync) |
| Sync Prompt | Optional. Prompt file controlling sync behavior (defaults to `agenda/sync/default.txt`) |

Then, in an agent → **Agenda** section, toggle Agenda on and pick the profile. Enabling it registers the agenda tools; with a sync model, items are reconciled from the conversation automatically each turn.

AgendaSync normally uses one model call with the completed turn and the full structure of every pending item. When that input exceeds the Sync Model budget, it reuses the same model to extract up to 12 agenda-change intents, locally ranks the complete pending catalog, and screens compact cards in at most 6 token-bounded batches. Batch results carry cross-batch relevance scores; the final Writer receives at most 20 selected full records. If those records still exceed the budget, trigger messages become 60-character previews. An oversized turn is middle-truncated while preserving its beginning and end. The Selector's `shouldSync` result is advisory—the final Writer still verifies every overflow turn—and one failed card batch falls back to local ranking instead of discarding the entire sync. This bounds an overflow run to at most 8 model calls (analysis + 6 batches + final Writer). There is no separate Selector Model setting.

From the Agenda Profiles page → **View** you can browse stored items, filter by pending/done/cancelled/expired, manually **Complete** / **Cancel**, add/edit/disable/reopen/delete triggers, fire a trigger manually for testing, and inspect each trigger's fire history. Reopening an expired item restores only the item to Pending; retime or re-enable an appropriate trigger separately.

## Agent Tools

Once enabled, the agent gets these tools:

| Tool | Purpose |
|------|---------|
| `agenda_create` | Create an item with one or more triggers |
| `agenda_list` | List current items (each trigger's `message` truncated to a preview) |
| `agenda_get` | Read one item in full by id: complete `message`, disabled triggers, timestamps, optional fire log |
| `agenda_edit` | Change item fields and/or triggers (add / patch / remove) in one atomic call |
| `agenda_close` | Terminate an item — `outcome: done` (finished) or `dropped` (no longer wanted) |
| `agenda_wiki` | In-tool reference for edge cases (multi-trigger, dueAt vs trigger, action choice) |

## Agenda vs Heartbeat

| Need | Use |
|------|-----|
| Stateful todos / reminders / schedules, auto-synced from conversation | **Agenda** |
| One-shot, interval, or cron triggers with delivery audit history | **Agenda** |
| Run a fixed prompt every N seconds/minutes against an agent | [Heartbeat](./heartbeat) |
