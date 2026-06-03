# Skills

Sidebar → **Skills**

Skills are installable Markdown prompt modules that extend agent capabilities with specialized knowledge or workflows. They are loaded into the system prompt only when the model decides a skill is relevant, keeping idle context cost low.

## Storage

Skill files live in `~/.sbot/skills/`. Each skill is a `SKILL.md` file with frontmatter (`name`, `description`) plus body.

## Installation

Three ways to add skills:

- **Search & install from a hub** — built-in registries: Clawhub, skills.sh, skillhub.cn
- **Custom registries** — add additional URLs in **Settings**
- **Manual** — drop `SKILL.md` files into `~/.sbot/skills/` directly

## Assignment

In an agent → **Skills** tab:

- Select specific skills to load
- Or leave empty to load **all** available skills (the agent picks per turn)

## Authoring

Minimal example:

```markdown
---
name: web-scraper
description: Use when the user asks to extract structured data from a webpage
---

# Web Scraper

When the user provides a URL...
```

The `description` is what triggers the skill — make it specific so the model can decide when to invoke it.
