# Memory

Memory lets facts survive conversations and restarts. Say "remember that…"
in a chat and the assistant keeps it; relevant memories are recalled into
the context of new turns automatically.

Memory is stored only in your local database.

## Using memory

- **Save** — say "remember that I prefer dark mode" or similar. The
  assistant calls the `memory_save` tool.
- **Recall** — at the start of a turn, relevant memories are recalled into
  the context. The launcher trace shows a **Context** step with the number
  of memories recalled.
- **Search** — the `memory_search` tool finds memories by keyword.
- **List / forget** — the `memory_list` and `memory_forget` tools.

Turn memory off entirely in **Settings → General → Let the assistant use
memory**. With it off, nothing is recalled and the assistant cannot save
new memories.

## The memories manager

**Settings → Tools → Memories** lists every stored memory:

- **Search** and browse the list.
- **Delete** any memory (source shown as **you** or **assistant**, plus
  its origin conversation).
- **Undo** a deletion.

## Smart merge

Deterministic dedupe always runs. Optionally, enable **Smart merge** so the
internal plumbing model arbitrates near-duplicates on save. Memory text is
sent to the assigned provider; deterministic dedupe stays active either
way.

- **Consolidate now** runs an on-demand pass over gray-zone
  near-duplicates (up to 20 pairs per run, with a 60-second cooldown).
- Merges keep **provenance** (`merged from N`), so undoing a merge restores
  everything.
- Your own memories are never auto-deleted.

## Document search

The assistant can search passages across your local documents.

1. Grant a folder in **Settings → Tools → Folders**.
2. In the same tab, enable the **Document index** for that folder.
3. Ask a question; the `docs_search` tool finds passages in the folder's
   markdown, text and PDF files.

The index is local-only and uses full-text search with ranking. The
section shows indexed file and passage counts, and a **Re-index** action
re-reads only changed files.

Indexing is opt-in per folder, and turning it off removes that folder's
indexed passages.
