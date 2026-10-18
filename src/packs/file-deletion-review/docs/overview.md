# Deletion review

Deletion review is a bundled mini-app pack for Desktop Assistant that
assesses a folder for files you could safely delete. It is deliberately
conservative: deterministic rules decide the clear majority of files,
a decision model judges only the residual, and nothing is ever removed
without your explicit approval.

- **Rules first.** Recently modified files, your exception globs, and
  sensitive patterns (`.env*`, `*.key`, `*.pem`, …) are settled by
  rules alone — no model call, no content read.
- **A model judges only the rest.** Ambiguous files (build caches, old
  logs, mystery data files) get typed questions — *is this safe to
  delete? how recoverable is it?* — answered with confidences you can
  inspect in the evidence drilldown.
- **Approval before anything moves.** Approved deletions are QUARANTINED
  (moved into the app's quarantine store), never unlinked — every item
  is restorable.

## When to use it

- Project folders bloated by `node_modules/`, `dist/`, `__pycache__/`
  and old build logs you want swept in one reviewed pass.
- Downloads or scratch directories where "safe to delete" needs a
  second opinion per file.
- Any folder where you want an auditable, reversible cleanup instead of
  `rm -rf`.

## When NOT to use it

- Whole-tree spring cleaning where you already know the verdict — the
  OS trash is faster.
- System directories — refused run roots (`/`, `/usr`, `/var`, …) are
  rejected before any scan.
- Anything requiring real deletion — the pack's only verb is
  move-to-quarantine (permanent delete is a non-goal by design).
