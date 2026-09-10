import { useCallback, useEffect, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { Brain, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { MemoryView } from '@shared/memory';
import { TEXT, interpolate, pluralize } from '@shared/constants/text';
import { presenceClass, usePresence } from '@renderer/hooks/usePresence';

interface UndoState {
  memory: MemoryView;
  timer: ReturnType<typeof setTimeout>;
}

const MEMORIES_PAGE = 100;
const SEARCH_DEBOUNCE_MS = 250;
const UNDO_WINDOW_MS = 6_000;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MemoriesManager(): JSX.Element {
  const [memories, setMemories] = useState<MemoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoVisible = undo !== null;
  const undoMounted = usePresence(undoVisible, 150);

  const load = useCallback(async (search: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const rows =
        search.trim().length > 0
          ? await window.electronAPI.searchMemories(search, MEMORIES_PAGE)
          : await window.electronAPI.listMemories(MEMORIES_PAGE);
      setMemories(rows);
    } catch {
      setError(TEXT.MEMORIES_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  useEffect(
    () => () => {
      if (undo) {
        clearTimeout(undo.timer);
      }
    },
    [undo]
  );

  const forget = (memory: MemoryView): void => {
    setMemories((prev) => prev.filter((row) => row.id !== memory.id));
    if (undo) {
      clearTimeout(undo.timer);
    }
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    setUndo({ memory, timer });
    void window.electronAPI.deleteMemory(memory.id);
  };

  const restoreDeleted = (): void => {
    if (!undo) {
      return;
    }
    clearTimeout(undo.timer);
    const { memory } = undo;
    setUndo(null);
    void window.electronAPI
      .restoreMemory({
        content: memory.content,
        source: memory.source,
        conversationId: memory.conversationId,
        tags: memory.tags,
      })
      .then((restored) => {
        setMemories((prev) =>
          [restored, ...prev.filter((row) => row.id !== restored.id)].sort(
            (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
          )
        );
      })
      .catch(() => void load(query));
  };

  return (
    <section className="da-rise space-y-3 rounded-xl border border-[var(--as-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Brain className="h-4 w-4 opacity-60" aria-hidden />
          {TEXT.MEMORIES_TITLE}
        </h4>
        <span className="text-xs opacity-60">
          {interpolate(TEXT.MEMORIES_COUNT, {
            count: memories.length,
            word: pluralize(memories.length, TEXT.MEMORY_ONE, TEXT.MEMORY_MANY),
          })}
        </span>
      </div>
      <p className="text-xs opacity-60">{TEXT.MEMORIES_SUBTITLE}</p>

      <div className="min-w-44 max-w-sm">
        <div className="flex items-center gap-2 rounded-[var(--as-radius)] border border-[var(--as-border)] bg-[var(--as-surface)] px-3 py-2 focus-within:border-[var(--as-focus-ring)]">
          <Search className="size-4 shrink-0 text-[var(--as-muted-fg)]" aria-hidden />
          <input
            type="text"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--as-fg)] outline-none placeholder:text-[var(--as-muted-fg)]"
            placeholder={TEXT.MEMORIES_SEARCH_PLACEHOLDER}
            aria-label={TEXT.MEMORIES_SEARCH_ARIA}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="rounded-[var(--as-radius-sm)] p-0.5 text-[var(--as-muted-fg)] transition-colors hover:text-[var(--as-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--as-focus-ring)]"
              aria-label={TEXT.TOOLS_SEARCH_CLEAR}
              onClick={() => setQuery('')}
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p role="status" className="flex items-center gap-2 py-3 text-sm opacity-60">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {TEXT.MEMORIES_LOADING}
        </p>
      ) : error ? (
        <div className="flex items-center gap-2 py-3 text-sm">
          <span className="text-red-500">{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load(query)}>
            {TEXT.MEMORIES_RETRY}
          </Button>
        </div>
      ) : memories.length === 0 ? (
        query.trim() ? (
          <EmptyState icon={Brain} title={TEXT.MEMORIES_NO_MATCHES} compact />
        ) : (
          <EmptyState icon={Brain} title={TEXT.MEMORIES_EMPTY} description={TEXT.MEMORIES_EMPTY_HINT} compact />
        )
      ) : (
        <ul aria-label={TEXT.MEMORIES_LIST_ARIA} className="divide-y divide-[var(--as-border)] overflow-hidden rounded-lg border border-[var(--as-border)]">
          {memories.map((memory) => (
            <li key={memory.id} className="flex items-start gap-2 px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm">{memory.content}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] opacity-60">
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {memory.source === 'user' ? TEXT.MEMORIES_SOURCE_USER : TEXT.MEMORIES_SOURCE_ASSISTANT}
                  </Badge>
                  <span>{shortDate(memory.updatedAt)}</span>
                  {memory.conversationId && (
                    <span className="font-mono">
                      {TEXT.MEMORIES_FROM_CONVERSATION} {memory.conversationId.slice(-6)}
                    </span>
                  )}
                  {memory.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={interpolate(TEXT.MEMORIES_DELETE_ARIA, { content: memory.content.slice(0, 40) })}
                onClick={() => forget(memory)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {undoMounted && undo && (
        <div
          role="status"
          className={presenceClass(
            undoVisible,
            'flex items-center justify-between gap-2 rounded-lg border border-[var(--as-border)] bg-[var(--as-muted)]/50 px-2.5 py-1.5 text-xs'
          )}
        >
          <span className="truncate">{TEXT.MEMORIES_FORGOT}</span>
          <Button variant="outline" size="sm" onClick={restoreDeleted}>
            {TEXT.MEMORIES_UNDO}
          </Button>
        </div>
      )}
    </section>
  );
}
