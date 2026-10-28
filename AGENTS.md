# Agent instructions

## Definition of Done (Mandatory Gate)

Before considering any code change or task done (even when not pushing), **always run `pnpm gate:fast` first**.

Do not declare completion with only piecemeal checks (`biome`, bare `tsc --noEmit`, or a single lint script). `pnpm gate:fast` bundles:

1. `biome check` (format + lint)
2. `lint:secrets` (`betterleaks` — secrets, tokens, API key leaks)
3. `lint:graph` (`rev-dep` — cycles, orphans, unused exports/deps, duplicates)
4. `lint:complexity` (Biome cognitive-complexity shrink-only ratchet)
5. `typecheck` (`tsc -b`)
6. `lint:py` (`ruff`, `basedpyright`, `tach`, `vulture`)

`pnpm gate` = `pnpm gate:fast && pnpm test` (CI and pre-push).

A task is not complete until `pnpm gate:fast` passes cleanly.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context repository. See `docs/agents/domain.md`.
