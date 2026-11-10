import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, Languages as LanguagesIcon, Plus, Search } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import { CUSTOM_LANGUAGE_CODE_PATTERN, findLanguage, resolveLanguage, sortedLanguages, type CustomLanguageEntry } from '@shared/languages';

export interface LanguagePickerProps {
  /** Stable prefix for the control's ids and test hooks. */
  idPrefix: string;
  /** '' / 'auto' / an ISO or custom code. */
  value: string;
  /** Id of the pane's visible label (aria-labelledby on the trigger). */
  labelId?: string;
  /** Offer the "Automatic — detect the language" entry. */
  withAuto?: boolean;
  /** Offer a typed code that the catalog does not carry (saved as a custom language). */
  allowCustom?: boolean;
  /** The user's custom languages (`config.translation.customLanguages`). */
  customLanguages?: CustomLanguageEntry[];
  /** Persists a typed code as a custom language; resolves the stored entry (null = refused). */
  onAddCustom?: (code: string) => Promise<CustomLanguageEntry | null>;
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PickerRow {
  value: string;
  label: string;
  nativeLabel?: string;
  flag?: string;
  custom?: boolean;
}

const AUTO_ROW: PickerRow = { value: 'auto', label: TEXT.LANGUAGE_PICKER_AUTO };

function matches(row: PickerRow, query: string): boolean {
  if (query.length === 0) {
    return true;
  }
  return (
    row.value.startsWith(query) ||
    row.label.toLowerCase().includes(query) ||
    (row.nativeLabel ?? '').toLowerCase().includes(query)
  );
}

/**
 * In-flow language browser (plan 69): a trigger plus an inline, searchable
 * list — no portal. The launcher window grows with the measured chrome, so
 * the list can never be clipped out of the window (the reason the library
 * Combobox was unusable in the compact launcher).
 */
export function LanguagePicker(props: LanguagePickerProps): JSX.Element {
  const { idPrefix, value, labelId, withAuto = false, allowCustom = false, customLanguages = [], open } = props;
  const [query, setQuery] = useState(() => '');
  const [activeIndex, setActiveIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(props.onOpenChange);
  const listId = `${idPrefix}-list`;

  useLayoutEffect(() => {
    openRef.current = open;
    onOpenChangeRef.current = props.onOpenChange;
  }, [open, props.onOpenChange]);

  const selected = useMemo((): PickerRow => {
    if (value === 'auto' || (value === '' && withAuto)) {
      return AUTO_ROW;
    }
    const entry = resolveLanguage(value, customLanguages);
    if (entry) {
      const custom = customLanguages.some((candidate) => candidate.code === entry.code);
      return { value: entry.code, label: entry.name, nativeLabel: entry.nativeName, flag: 'flag' in entry ? entry.flag : undefined, custom };
    }
    return { value, label: value, custom: true };
  }, [customLanguages, value]);

  const normalizedQuery = query.trim().toLowerCase();

  const rows = useMemo((): PickerRow[] => {
    const catalog: PickerRow[] = sortedLanguages().map((entry) => ({
      value: entry.code,
      label: entry.name,
      nativeLabel: entry.nativeName,
      flag: entry.flag,
    }));
    const custom: PickerRow[] = customLanguages
      .filter((entry) => entry.code !== 'auto' && !findLanguage(entry.code))
      .map((entry) => ({ value: entry.code, label: entry.name, nativeLabel: entry.nativeName, custom: true }));
    const all: PickerRow[] = [...(withAuto ? [AUTO_ROW] : []), ...custom, ...catalog];
    const visible = all.filter((row) => matches(row, normalizedQuery));
    const currentKnown = visible.some((row) => row.value === value);
    return currentKnown || value.length === 0 ? visible : [selected, ...visible];
  }, [customLanguages, normalizedQuery, selected, value, withAuto]);

  const canCreate =
    allowCustom &&
    props.onAddCustom !== undefined &&
    CUSTOM_LANGUAGE_CODE_PATTERN.test(normalizedQuery) &&
    normalizedQuery !== 'auto' &&
    !findLanguage(normalizedQuery) &&
    !customLanguages.some((entry) => entry.code === normalizedQuery);

  const optionCount = rows.length + (canCreate ? 1 : 0);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      setAdding(false);
      setAddError(null);
      return;
    }
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => (current >= 0 && current < optionCount ? current : 0));
  }, [optionCount]);

  const pick = useCallback(
    (next: PickerRow): void => {
      props.onChange(next.value);
      props.onOpenChange(false);
    },
    [props]
  );

  const addCustom = useCallback(async (): Promise<void> => {
    const code = normalizedQuery;
    const onAddCustom = props.onAddCustom;
    if (onAddCustom === undefined) {
      return;
    }
    setAdding(true);
    setAddError(null);
    const entry = await onAddCustom(code).catch(() => null);
    setAdding(false);
    if (entry === null) {
      setAddError(interpolate(TEXT.LANGUAGE_PICKER_ADD_FAILED, { code }));
      return;
    }
    props.onChange(entry.code);
    props.onOpenChange(false);
  }, [normalizedQuery, props]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) {
        return;
      }
      onOpenChangeRef.current(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onOpenChangeRef.current(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) {
      return;
    }
    const node = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, optionCount - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(optionCount - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= rows.length && canCreate) {
        void addCustom();
        return;
      }
      const row = rows[activeIndex];
      if (row !== undefined) {
        pick(row);
      }
    }
  };

  const triggerLabel = selected.value === 'auto' ? TEXT.LANGUAGE_PICKER_AUTO_SHORT : selected.label;
  const triggerFlag = selected.value === 'auto' ? null : selected.flag;

  return (
    <div ref={rootRef} className="flex min-w-0 flex-1 flex-col gap-1">
      <button
        type="button"
        data-testid={`${idPrefix}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        {...(labelId !== undefined ? { 'aria-labelledby': labelId } : {})}
        onClick={() => props.onOpenChange(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1 text-left text-xs hover:border-[var(--as-primary)]/50"
      >
        {triggerFlag ? (
          <span className="w-4 shrink-0 text-center text-[13px] leading-none" aria-hidden>
            {triggerFlag}
          </span>
        ) : (
          <LanguagesIcon className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        {selected.custom && <span className="shrink-0 text-[10px] text-[var(--as-muted-fg)]">{TEXT.LANGUAGE_PICKER_CUSTOM}</span>}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
      </button>
      {open && (
        <div className="flex flex-col gap-1 rounded-md border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-1.5" data-no-drag>
          <div className="flex items-center gap-1.5 border-b border-[var(--as-border)] px-1 pb-1">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 && activeIndex < rows.length ? `${listId}-opt-${activeIndex}` : undefined}
              aria-label={TEXT.LANGUAGE_PICKER_SEARCH}
              placeholder={TEXT.LANGUAGE_PICKER_SEARCH}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              className="h-6 w-full min-w-0 bg-transparent text-xs outline-none placeholder:opacity-50"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={TEXT.LANGUAGE_PICKER_LIST} className="max-h-56 overflow-y-auto">
            {rows.map((row, index) => {
              const isActive = index === activeIndex;
              const isSelected = row.value === value || (row.value === 'auto' && value === '');
              return (
                <li
                  key={`${row.custom === true ? 'custom' : 'lang'}:${row.value}`}
                  id={`${listId}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  data-index={index}
                  data-testid={`${idPrefix}-option-${row.value}`}
                  onClick={() => pick(row)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs ${
                    isActive ? 'bg-[var(--as-primary)]/10' : ''
                  }`}
                >
                  <span className="flex w-5 shrink-0 justify-center text-[13px] leading-none" aria-hidden>
                    {row.flag ? row.flag : <LanguagesIcon className="h-3.5 w-3.5 opacity-60" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {row.label}
                    {row.nativeLabel !== undefined && row.nativeLabel !== row.label && (
                      <span className="ml-1.5 opacity-60">{row.nativeLabel}</span>
                    )}
                  </span>
                  {row.custom === true && <span className="shrink-0 text-[10px] text-[var(--as-muted-fg)]">{TEXT.LANGUAGE_PICKER_CUSTOM}</span>}
                  <span className="shrink-0 text-[10px] uppercase opacity-40">{row.value === 'auto' ? '' : row.value}</span>
                </li>
              );
            })}
            {rows.length === 0 && canCreate && (
              <li role="presentation" className="px-1.5 py-2 text-center text-[11px] text-[var(--as-muted-fg)]">
                {TEXT.LANGUAGE_PICKER_NO_MATCH}
              </li>
            )}
          </ul>
          {canCreate && (
            <button
              type="button"
              data-testid={`${idPrefix}-create`}
              disabled={adding}
              onClick={() => void addCustom()}
              className="flex items-center gap-1.5 rounded border-t border-[var(--as-border)] px-1.5 py-1 text-left text-xs hover:bg-[var(--as-primary)]/10 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {interpolate(TEXT.LANGUAGE_PICKER_USE_CUSTOM, { code: normalizedQuery })}
              </span>
            </button>
          )}
          {addError !== null && (
            <p role="alert" className="px-1 text-[11px] text-[var(--as-destructive)]">
              {addError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
