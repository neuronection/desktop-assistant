# Desktop Assistant documentation

This directory holds the project's documentation, split by audience.

| Audience | Start here | What it covers |
|---|---|---|
| **Users** | [user/README.md](user/README.md) | Installing, summoning, chatting, voice, tools and approvals, apps, memory, decisions, translation, automation, every setting, privacy |
| **Developers** | [dev/README.md](dev/README.md) | Architecture, development workflow, IPC surface, testing, data model, AI layer, tools and policy, security, packaging |
| **Everyone** | [STATUS.md](STATUS.md) | Single source of truth for what exists and the current phase |

The [root README](../README.md) is the marketing/short overview; this
directory is the manual.

## Documentation rules

- Canonical architecture and behavior live in the tracked `docs/` — code
  comments point here instead of restating design.
- Every behavior, schema or IPC change updates its page **in the same
  commit** as the code (see `AGENTS.md`).
- User-facing wording in the guides matches the strings in
  `src/shared/constants/text.ts`; if the UI says it differently, the UI
  wins and the guide is wrong.
- The four developer pages moved from the `docs/` root keep their old
  names; links elsewhere in the repo point at `docs/dev/`.
