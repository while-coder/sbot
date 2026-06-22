# Heartbeat

Sidebar → **Heartbeats** → New

Heartbeat lets an agent wake itself up on a fixed interval and run a prompt without any user message — useful for monitoring, daily summaries, scheduled outreach, or any "check in periodically and do X" workflow.

## When to Use Heartbeat vs Scheduler

| Need | Use |
|------|-----|
| Run a fixed prompt every N seconds/minutes | **Heartbeat** |
| Run on cron (e.g. weekdays at 9am) | [Scheduler tool](./tools#scheduler) |
| One-off reminder | [Scheduler tool](./tools#scheduler) |

Heartbeat is a higher-level loop attached to an agent + target; the Scheduler tool is a lower-level cron primitive the agent can call itself.

## Configuration

| Field | Description |
|-------|-------------|
| Name | Display name |
| Agent | Which agent should run on each tick |
| Target | A specific channel user, web session, or working directory |
| Interval | Tick period (seconds/minutes/hours) |
| Prompt | Prompt template the agent receives on each tick |
| Enabled | Toggle without deleting |

## Examples

- **Status digest** — every 1h, summarize new messages in a busy Lark group and drop the digest in a "summary" thread
- **Watchdog** — every 5min, query a health endpoint via the Web tool; ping you only on failure
- **Standup buddy** — every weekday morning, ask the user how yesterday went and write a note

## Notes

- Each heartbeat target gets its own conversation thread (isolated history)
- Combine with [Memory](./memory) so the agent learns from each tick
- For stateful reminders/schedules driven by conversation content, use [Agenda](./agenda) instead
- Disable a heartbeat to pause without losing its config
