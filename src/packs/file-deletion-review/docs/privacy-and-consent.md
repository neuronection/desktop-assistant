# Privacy & consent

## What the pack reads

File **metadata only** by default: path, name, extension, size, and
modification time. Content excerpts are read **only** when you turn on
*Send content excerpts to the decision model* in the pack's config, and
even then:

- excerpts are capped (4 KB per file),
- sensitive globs are **never** read or sent — your exception list,
  the pack's declared list, AND the host's enforced baseline
  (`.env*`, `*credential*`, `*secret*`, `id_rsa*`, `*.kdbx`, `*.pem`,
  `*.key`, `*token*`) union together; the baseline applies regardless
  of what the pack declares.

## What leaves your machine

Decision questions run through the app's configured decision engine —
the same audited, budgeted funnel every assistant decision uses. The
run-start surface discloses the exact split before the run starts:
metadata is always part of question framing; content excerpts ride
only with `sendsContent` + your explicit toggle. A fully local engine
configuration keeps everything on-device.

## Why nothing moves without you

The pack's single destructive verb is **move-to-quarantine**, and it
executes only through the approval card you arm explicitly:

- model output can never arm, execute, or schedule a mutation;
- every item is re-fingerprinted at move time — changed files drop to
  *ask* instead of moving;
- arming is abortable: not-yet-moved items return to *ask*,
  already-moved items stay restorable;
- one audit row per external effect.

This is the family's HITL Class-B floor (ADR-0015): detached cards,
idempotent resolve, conflict = rebase-or-reject.
