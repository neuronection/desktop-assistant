# Contributing

Thanks for contributing to Desktop Assistant — part of the Neuronection
assistant family.

## Ground rules

1. **Never commit untested code.** Run the verification gate before every
   commit (`npm run verify`); tests for new behavior land in the same
   commit.
2. **Docs ship with code.** Behavior/schema/API changes update docs and
   `CHANGELOG.md` (`## [Unreleased]`) in the same commit.
3. **No comments in code** unless requested; mimic existing style.
4. **Secrets stay out.** `.env` is gitignored; never commit keys or tokens.
5. App code never imports provider SDKs directly — model access goes
   through the app's AI layer (see `docs/architecture.md`).

## Development setup

```bash
npm install
npm run prisma:generate
npm run dev        # vite + tsc watch + electron
```

Verification gate:

```bash
npm run verify    # eslint + tsc (renderer & main) + vitest + build
```

## Pull requests

- One logical change per PR; verification gate green in CI.
- User-visible changes include a changelog entry.
- AI-related changes follow the family patterns (structured outputs,
   audited calls, provider-agnostic configuration).
