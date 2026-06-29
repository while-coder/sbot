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

When a trigger fires it delivers its `message` to the bound session/channel using its `action` mode, and the fire is recorded in the `trigger_fire` log table (pure audit, not used for scheduling). One-shot `absolute` triggers retry briefly on delivery failure, then give up.

## Configuration

An **Agenda Profile** is the store + optional auto-sync. Sidebar → **Agenda Profiles** → New:

| Field | Description |
|-------|-------------|
| Name | Display name for this profile |
| Sync Model | Optional. The model that auto-syncs agenda items from the conversation after each turn (leave empty to disable sync) |
| Sync Prompt | Optional. Prompt file controlling sync behavior (defaults to `agenda/sync/default.txt`) |

Then, in an agent → **Agenda** section, toggle Agenda on and pick the profile. Enabling it registers the agenda tools; with a sync model, items are reconciled from the conversation automatically each turn.

From the Agenda Profiles page → **View** you can browse stored items, filter by pending/done, manually **Complete** / **Cancel**, or fire a trigger manually for testing.

## Agent Tools

Once enabled, the agent gets these tools:

| Tool | Purpose |
|------|---------|
| `agenda_create` | Create an item with one or more triggers |
| `agenda_list` | List current items |
| `agenda_update` | Modify an item or its triggers |
| `agenda_complete` | Mark an item done |
| `agenda_cancel` | Cancel an item |
| `agenda_trigger` | Fire / manage a trigger |
| `agenda_wiki` | In-tool reference for edge cases (multi-trigger, dueAt vs trigger, action choice) |

## Agenda vs Heartbeat vs Scheduler

| Need | Use |
|------|-----|
| Stateful todos / reminders / schedules, auto-synced from conversation | **Agenda** |
| Run a fixed prompt every N seconds/minutes against an agent | [Heartbeat](./heartbeat) |
| Low-level cron primitive the agent calls itself for a one-off | [Scheduler tool](./tools#scheduler) |
