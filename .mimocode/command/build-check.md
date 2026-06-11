---
description: Build and type-check sbot packages
---

# Build & Type-Check

Run build and type-check across sbot packages to verify changes.

## Usage

Use this command after making code changes to ensure everything compiles:

```bash
# Build scorpio.ai first (dependency)
pnpm --filter scorpio.ai build 2>&1 | tail -10

# Then build sbot
pnpm --filter sbot build 2>&1 | tail -5

# Type-check sbot (optional, faster than full build)
cd e:/sbot/packages/sbot && pnpm exec tsc --noEmit 2>&1
```

## Package Build Order

1. `scorpio.ai` (core AI package - builds first)
2. `sbot` (main application)
3. `channel.*` packages (if modified)

## Quick Verify

For a quick check after small changes:

```bash
cd e:/sbot/packages/sbot && pnpm exec tsc --noEmit 2>&1 | head -20
```

## Full Verification

For comprehensive verification:

```bash
pnpm -C packages/scorpio.ai build 2>&1
pnpm -C packages/sbot build 2>&1
```
