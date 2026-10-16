// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, fireEvent, getByText } from '@testing-library/react';
import axe from 'axe-core';
import {
  PACK_REPORT_COMPONENTS,
  PACK_RUN_ACTIONS,
  PACK_ITEM_ACTIONS,
} from '@shared/app-pack';
import type { PackSurfaceAction, PackSurfaceRow, PackSurfaceView } from '@shared/app-pack';
import { PackSurfaceRenderer, isSurfaceActionId, surfaceProgressPercent } from '@renderer/shared/PackSurfaceRenderer';

const HERE = join(process.cwd(), 'contracts');

function loadFixtures(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(HERE, 'surface-renderer.fixtures.json'), 'utf8'));
}

type Expectation = Record<string, unknown>;

const asText = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

function queryTestId(container: HTMLElement, testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${CSS.escape(testId)}"]`);
}

/** Renders one fixture case through desktop's renderer core — the SAME
 * component the ui:window host and the in-app report modal mount. */
function renderCase(fixtureCase: Record<string, unknown>) {
  const surface = fixtureCase.surface as Record<string, unknown>;
  const labels = {
    ...((surface.labels ?? {}) as Record<string, string>),
    ...((fixtureCase.labels ?? {}) as Record<string, string>),
  };
  const actions: PackSurfaceAction[] = [];
  const filterEvents: Array<{ facet: string; value: string | null }> = [];
  const view: PackSurfaceView = {
    nodes: surface.nodes as PackSurfaceView['nodes'],
    rows: (surface.rows ?? undefined) as PackSurfaceRow[] | undefined,
    values: (surface.values ?? undefined) as PackSurfaceView['values'],
    groups: (surface.groups ?? undefined) as PackSurfaceView['groups'],
  };
  const utils = render(
    <PackSurfaceRenderer
      surface={view}
      labels={labels}
      filters={(fixtureCase.filters ?? undefined) as never}
      activeFilters={(fixtureCase.activeFilters ?? undefined) as Record<string, string> | undefined}
      truncatedLabel={(fixtureCase.truncatedLabel ?? undefined) as string | undefined}
      onAction={(action) => actions.push(action)}
      onFilterChange={(facet, value) => filterEvents.push({ facet, value })}
    />
  );
  return { utils, actions, filterEvents };
}

function assertExpectation(entry: Expectation, utils: ReturnType<typeof render>['utils']): void {
  const container = utils.container;
  const kind = entry.kind as string;
  switch (kind) {
    case 'note':
    case 'no-html':
      return;
    case 'component': {
      const id = entry.id as string;
      const el = queryTestId(container, `surface-${id}`);
      expect(el, `missing component ${id}`).not.toBeNull();
      if (entry.label !== undefined) {
        const labelText = asText(entry.label);
        const matched = Array.from(el!.querySelectorAll('*')).some((child) => child.textContent === labelText && child !== el);
        if (!matched) {
          throw new Error(`component ${id}: label ${labelText} not rendered`);
        }
      }
      if (entry.value !== undefined) {
        const value = asText(entry.value);
        const matched = Array.from(el!.querySelectorAll('*')).some((child) => child.textContent === value);
        if (!matched) {
          throw new Error(`component ${id}: value ${value} not rendered`);
        }
      }
      if (entry.columns !== undefined) {
        const columns = (entry.columns as string[]).map(asText);
        const headers = Array.from(el!.querySelectorAll('th')).map((th) => th.textContent);
        expect(headers).toEqual(columns);
      }
      if (entry.rows !== undefined) {
        for (const row of entry.rows as Expectation[]) {
          const rowEl = queryTestId(container, `surface-row-${row.rowId}`);
          expect(rowEl, `row ${row.rowId} missing`).not.toBeNull();
          const cells = (row.cells ?? []) as string[];
          const cellEls = Array.from((el as HTMLElement).querySelectorAll(`[data-testid^="surface-cell-${row.rowId}-"]`));
          expect(cellEls.map((cell) => cell.querySelector('.block')?.textContent ?? cell.textContent)).toEqual(cells.map(asText));
          if (row.evidenceSummary !== undefined) {
            const evidence = queryTestId(container, `surface-evidence-${row.rowId}`);
            expect(evidence?.querySelector('summary')?.textContent).toBe(asText(row.evidenceSummary));
          }
        }
      }
      if (entry.optionText !== undefined) {
        const expected = (entry.optionText as unknown[]).map(asText);
        const select = el!.querySelector('select');
        expect(select, `component ${id}: no select`).not.toBeNull();
        const options = Array.from(select!.options).map((option) => option.textContent);
        expect(options).toEqual(expected);
      }
      return;
    }
    case 'bar': {
      const id = entry.id as string;
      const host = queryTestId(container, `surface-${id}`);
      expect(host, `bar ${id} missing`).not.toBeNull();
      const bar = host!.querySelector('[role="progressbar"]');
      expect(bar, `bar ${id} missing`).not.toBeNull();
      if (entry.label !== undefined) {
        expect(bar!.getAttribute('aria-label')).toBe(asText(entry.label));
      }
      expect(bar!.getAttribute('aria-valuenow')).toBe(String(entry.percent));
      return;
    }
    case 'row': {
      const rowId = asText(entry.rowId);
      const row = queryTestId(container, `surface-row-${rowId}`);
      expect(row, `row ${rowId} missing`).not.toBeNull();
      if (entry.title !== undefined) {
        expect(row!.querySelector('.truncate')?.textContent).toBe(asText(entry.title));
      }
      if (entry.badge !== undefined) {
        const badges = Array.from(row!.querySelectorAll('[data-as="badge"]'));
        expect(badges.some((badge) => badge.textContent === asText(entry.badge))).toBe(true);
      }
      if (entry.meta !== undefined) {
        const meta = entry.meta as string[];
        for (const segment of meta) {
          expect(
            Array.from(row!.querySelectorAll('*')).some((child) => child.textContent === segment && child !== row),
            `meta segment ${segment} missing on ${rowId}`
          ).toBe(true);
        }
      }
      if (entry.evidenceSummary !== undefined) {
        expect(row!.querySelector('summary')?.textContent).toBe(asText(entry.evidenceSummary));
      }
      if (entry.actionLabel !== undefined) {
        const buttons = Array.from(row!.querySelectorAll('button'));
        expect(buttons.some((button) => button.textContent === asText(entry.actionLabel))).toBe(true);
      }
      if (entry.section !== undefined) {
        const section = entry.section as { heading: string; count: number };
        const region = row!.closest('section');
        expect(region).not.toBeNull();
        expect(region!.getAttribute('aria-label')).toBe(asText(section.heading));
        expect(region!.querySelectorAll('[data-testid^="surface-row-"]').length).toBe(section.count);
      }
      return;
    }
    case 'text': {
      const text = asText(entry.text);
      const el = getByText(utils.container, text);
      if (entry.role !== undefined) {
        expect(el.getAttribute('role')).toBe(asText(entry.role));
      }
      if (entry.aria !== undefined) {
        for (const [name, value] of Object.entries(entry.aria as Record<string, unknown>)) {
          expect(el.getAttribute(name)).toBe(asText(value));
        }
      }
      return;
    }
    case 'click': {
      const target = queryTestId(utils.container, asText(entry.click));
      expect(target, `click target missing: ${entry.click}`).not.toBeNull();
      if (entry.text !== undefined) {
        expect(target!.textContent).toBe(asText(entry.text));
      }
      return;
    }
    case 'change':
      return;
    case 'absent': {
      expect(queryTestId(utils.container, asText(entry.testid)), `${entry.testid} must never render`).toBeNull();
      return;
    }
    default:
      throw new Error(`unknown expectation kind ${kind}`);
  }
}

async function scanNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

afterEach(cleanup);

describe('surface renderer — family vocabulary parity', () => {
  const fixtures = loadFixtures();

  it('the vendored fixture suite is byte-identical to the family canonical when ../dev is present', () => {
    const dev = join(process.cwd(), '..', 'dev', 'contracts', 'surface-renderer.fixtures.json');
    if (!existsSync(dev)) {
      return;
    }
    expect(readFileSync(dev, 'utf8')).toBe(readFileSync(join(HERE, 'surface-renderer.fixtures.json'), 'utf8'));
  });

  it('desktop renders the charter component + action vocabularies (closed, contract-generated)', () => {
    const vocab = fixtures.vocabulary as { components: string[]; actions: { run: string[]; item: string[] } };
    expect([...PACK_REPORT_COMPONENTS]).toEqual(vocab.components);
    expect([...PACK_RUN_ACTIONS]).toEqual(vocab.actions.run);
    expect([...PACK_ITEM_ACTIONS]).toEqual(vocab.actions.item);
  });

  it('filters unknown action ids at the render seam', () => {
    expect(isSurfaceActionId('run:export')).toBe(true);
    expect(isSurfaceActionId('item:open')).toBe(true);
    expect(isSurfaceActionId('run:explode')).toBe(false);
    expect(isSurfaceActionId('nonsense')).toBe(false);
  });

  it('resolves progress binds: {done,total} shapes, raw percents, missing ⇒ 0', () => {
    expect(surfaceProgressPercent({ done: 3, total: 4 })).toBe(75);
    expect(surfaceProgressPercent(66.4)).toBe(66);
    expect(surfaceProgressPercent(120)).toBe(100);
    expect(surfaceProgressPercent(undefined)).toBe(0);
    expect(surfaceProgressPercent({ done: 2, total: 0 })).toBe(0);
  });
});

describe('surface renderer — family fixture parity wall (ADR-0040 clause 16 / D23)', () => {
  const fixtures = loadFixtures();
  const cases = fixtures.cases as Array<Record<string, unknown>>;

  it('the suite carries the degrade probes', () => {
    const probes = cases.filter((fixtureCase) => fixtureCase.degradeProbe === true).map((fixtureCase) => fixtureCase.id);
    expect(probes.length).toBeGreaterThanOrEqual(3);
  });

  it.each(cases.map((fixtureCase) => fixtureCase.id as string))('fixture case: %s', async (caseId) => {
    const fixtureCase = cases.find((candidate) => candidate.id === caseId)!;
    const { utils, actions, filterEvents } = renderCase(fixtureCase);

    for (const entry of fixtureCase.expect as Expectation[]) {
      assertExpectation(entry, utils);
    }

    for (const entry of (fixtureCase.expect as Expectation[]).filter((candidate) => candidate.kind === 'click')) {
      const testId = asText(entry.click);
      const target = queryTestId(utils.container, testId) as HTMLElement;
      expect(target, `click target missing: ${testId}`).not.toBeNull();
      const before = { actions: [...actions], filterEvents: [...filterEvents] };
      fireEvent.click(target);
      if (entry.event !== undefined) {
        const event = entry.event as Record<string, unknown>;
        if (typeof event.facet === 'string') {
          expect(filterEvents.slice(before.filterEvents.length)).toEqual([{ facet: event.facet, value: event.value as string | null }]);
        } else {
          expect(actions.slice(before.actions.length)).toEqual([
            { id: event.id, ...(event.rowId !== undefined && event.rowId !== null ? { rowId: event.rowId as string } : {}) },
          ]);
        }
      }
    }

    for (const entry of (fixtureCase.expect as Expectation[]).filter((candidate) => candidate.kind === 'change')) {
      const testId = asText(entry.select);
      const selectEl = queryTestId(utils.container, testId) as HTMLSelectElement;
      expect(selectEl).not.toBeNull();
      const value = asText(entry.value);
      expect(Array.from(selectEl.options).some((option) => option.value === value)).toBe(true);
      fireEvent.change(selectEl, { target: { value } });
      const event = entry.event as { facet: string; value: string | null };
      expect(filterEvents[filterEvents.length - 1]).toEqual({ facet: event.facet, value: event.value });
    }

    expect(utils.container.querySelector('script, iframe, style, img, object, embed')).toBeNull();
    expect(utils.container.querySelector('a[href^="javascript:"]')).toBeNull();
    for (const element of Array.from(utils.container.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes ?? [])) {
        if (attribute.name.startsWith('on')) {
          throw new Error(`inline handler leaked: ${attribute.name}`);
        }
      }
    }

    await scanNoViolations(utils.container);
  });
});
