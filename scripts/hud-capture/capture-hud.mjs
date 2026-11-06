#!/usr/bin/env node
/**
 * Pulse HUD capture loop (plan 58 addendum).
 *
 * Renders the REAL speech overlay renderer in Chromium through its dev-only
 * capture harness (`?capStyle=…&capVisual=…&capSide=…&capTheme=…`), at 2×
 * device scale with a transparent background, for every style × state ×
 * dock side × theme. Then composes labeled contact sheets so the design can
 * be reviewed as one image.
 *
 * The harness is inert in Electron (the preload bridge exists there) and in
 * production builds.
 *
 * Usage:
 *   node scripts/hud-capture/capture-hud.mjs --round 1
 *   node scripts/hud-capture/capture-hud.mjs --round 2 --port 3310
 *
 * Prerequisite: the vite dev server is running (`./scripts/run-dev.sh` or
 * `VITE_PORT=3310 npx vite`). Output defaults to /tmp/opencode/hud-design.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const ROUND = Number(flag('round', '1'));
const PORT = Number(flag('port', process.env.VITE_PORT || '3310'));
const OUT_ROOT = flag('out', '/tmp/opencode/hud-design');
const OUT_DIR = join(OUT_ROOT, `round-${ROUND}`);
const BASE = `http://localhost:${PORT}/speech-overlay.html`;

const THEMES = ['classic', 'dark'];
const STYLES = ['card', 'mini', 'edge', 'dot'];
const STATES = ['idle', 'speaking', 'listening', 'paused', 'error'];
const SIDES = ['right', 'left', 'top', 'bottom'];

const STATE_LABEL = {
  idle: 'idle',
  speaking: 'speaking',
  listening: 'listening',
  paused: 'paused',
  error: 'error',
};
const STYLE_LABEL = { card: 'card (400×72)', mini: 'mini (160×36)', edge: 'dock tab (30×68)', dot: 'orb (28×28)' };

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function cellHtml({ file, state, detail, style, side, docked }) {
  const data = readFileSync(join(OUT_DIR, file)).toString('base64');
  const edgeClass = style === 'edge' && docked ? ` edge-${side}` : '';
  return `<figure class="cell">
    <div class="art${edgeClass}"><img alt="" src="data:image/png;base64,${data}"></div>
    <figcaption><strong>${escapeHtml(state)}</strong><span>${escapeHtml(detail)}</span></figcaption>
  </figure>`;
}

function rowHtml({ label, cells }) {
  return `<div class="row"><h3>${escapeHtml(label)}</h3><div class="grid">${cells.join('')}</div></div>`;
}

function stateRow({ theme, style, side = 'right', docked = false, results, states = STATES }) {
  const detail = style === 'card' ? 'progress 3/7' : style === 'edge' ? `${side} dock` : 'presence only';
  return rowHtml({
    label: style === 'edge' ? side : '',
    cells: states.map((state) => {
      const file = `${theme}-${style}-${state}-${side}.png`;
      const found = results.find((r) => r.file === file);
      return found ? cellHtml({ file, state, detail, style, side, docked }) : '<figure class="cell empty"></figure>';
    }),
  });
}

function fallbackRow({ results }) {
  const cells = ['card', 'edge'].map((style) => {
    const file = `opaque-dark-${style}-speaking-right.png`;
    const found = results.find((r) => r.file === file);
    return found
      ? cellHtml({ file, state: `${style} · opaque`, detail: 'solid fallback', style, side: 'right', docked: style === 'edge' })
      : '<figure class="cell empty"></figure>';
  });
  while (cells.length < STATES.length) {
    cells.push('<figure class="cell empty"></figure>');
  }
  return rowHtml({ label: 'no blur', cells });
}

function hoverRow({ theme, results }) {
  const files = ['idle', 'speaking'].map((state) => ({
    state,
    file: `hover-${theme}-edge-${state}-right.png`,
  }));
  const cells = files.map(({ state, file }) => {
    const found = results.find((r) => r.file === file);
    return found
      ? cellHtml({ file, state: `${state} · hover`, detail: 'face grows 6px', style: 'edge', side: 'right', docked: true })
      : '<figure class="cell empty"></figure>';
  });
  while (cells.length < STATES.length) {
    cells.push('<figure class="cell empty"></figure>');
  }
  return rowHtml({ label: 'hover', cells });
}

function sectionHtml(theme, rows, suffix = ' theme') {
  return `<section class="sheet-section">
    <h2>${escapeHtml(theme)}${suffix}</h2>
    ${rows}
  </section>`;
}

function sheetHtml({ title, subtitle, blocks, kind }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 28px 32px 40px; background: #14161d; color: #e8ecf6;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: .01em; }
    .sub { color: #98a1b8; font-size: 12.5px; margin-bottom: 22px; max-width: 960px; line-height: 1.45; }
    h2 { font-size: 14px; margin: 30px 0 12px; color: #cfd6e6; text-transform: uppercase; letter-spacing: .12em; }
    .sheet-section:first-of-type h2 { margin-top: 8px; }
    .row { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
    .row h3 { width: 58px; margin: 4px 0 0; font-size: 11.5px; color: #8f99b0; font-weight: 600;
      text-align: right; letter-spacing: .04em; }
    .grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; flex: 1; }
    .cell { margin: 0; border-radius: 8px; overflow: hidden; background: #1b1f2a;
      border: 1px solid #2b3142; }
    .cell.empty { background: #171a22; border-style: dashed; }
    .art { height: 108px; display: flex; align-items: center; justify-content: center; padding: 8px;
      background:
        radial-gradient(120% 90% at 18% 8%, rgba(110, 168, 255, .22), transparent 55%),
        radial-gradient(110% 100% at 88% 100%, rgba(255, 140, 190, .18), transparent 55%),
        linear-gradient(150deg, #3c465e 0%, #262c3c 48%, #161a24 100%); }
    .art img { max-width: 100%; max-height: 92px; }
    /* Docked captures sit against the simulated screen edge, no padding there. */
    .art.edge-right { justify-content: flex-end; padding: 8px 0 8px 8px; box-shadow: inset -2px 0 0 rgba(255,255,255,.22); }
    .art.edge-left { justify-content: flex-start; padding: 8px 8px 8px 0; box-shadow: inset 2px 0 0 rgba(255,255,255,.22); }
    .art.edge-top { align-items: flex-start; padding: 0 8px 8px; box-shadow: inset 0 2px 0 rgba(255,255,255,.22); }
    .art.edge-bottom { align-items: flex-end; padding: 8px 8px 0; box-shadow: inset 0 -2px 0 rgba(255,255,255,.22); }
    .sheet-docks .art { height: 300px; }
    .sheet-docks .art img { max-height: 280px; }
    figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 6px;
      padding: 6px 8px 7px; font-size: 10.5px; border-top: 1px solid #262c3a; }
    figcaption strong { font-weight: 650; color: #dfe5f2; }
    figcaption span { color: #8791a8; font-size: 9.5px; white-space: nowrap; }
    .legend { display: flex; gap: 16px; font-size: 11px; color: #8f99b0; margin: 0 0 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; }
  </style></head><body class="${kind === 'docks' ? 'sheet-docks' : ''}">
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">${escapeHtml(subtitle)}</div>
    <div class="legend">
      <span><i class="dot" style="background:#6ea8ff"></i>speaking</span>
      <span><i class="dot" style="background:#2fd3c0"></i>listening</span>
      <span><i class="dot" style="background:#f5b04a"></i>paused</span>
      <span><i class="dot" style="background:#ff6b81"></i>error</span>
      <span><i class="dot" style="background:#8a93a8"></i>idle</span>
    </div>
    ${blocks}
  </body></html>`;
}

/** Controls must never sit on top of a visualization (bars, wave, track, fill). */
async function assertNoOverlap(page, style) {
  const pairs = await page.evaluate(() => {
    const hit = (a, b) =>
      a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    const buttons = [...document.querySelectorAll('.hud-ghost')].map((el) => ({
      el,
      r: el.getBoundingClientRect(),
    }));
    const visuals = [
      ...document.querySelectorAll('.hud-wave, .hud-tab-bars, .sh-knob-fill, .sh-track, .sh-mini-track'),
    ].map((el) => ({ el, r: el.getBoundingClientRect() }));
    const found = [];
    for (const visual of visuals) {
      for (const button of buttons) {
        if (hit(visual.r, button.r)) {
          found.push(`${visual.el.className} × ${button.el.getAttribute('aria-label')}`);
        }
      }
    }
    return found;
  });
  if (pairs.length > 0) {
    throw new Error(`[${style}] control/visualization overlap: ${pairs.join(', ')}`);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 460, height: 180 } });
  const page = await context.newPage();
  const results = [];

  for (const theme of THEMES) {
    for (const style of STYLES) {
      for (const state of STATES) {
        const sides = style === 'edge' ? SIDES : ['right'];
        for (const side of sides) {
          const file = `${theme}-${style}-${state}-${side}.png`;
          const url = `${BASE}?capStyle=${style}&capVisual=${state}&capSide=${side}&capTheme=${theme}`;
          await page.setViewportSize({ width: 460, height: 180 });
          await page.goto(url, { waitUntil: 'load' });
          await page.waitForSelector('.hud-stage');
          const box = await page.locator('.hud-stage').evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
          });
          await page.setViewportSize(box);
          await page.waitForTimeout(420);
          await assertNoOverlap(page, style);
          await page.screenshot({ path: join(OUT_DIR, file), omitBackground: true });
          results.push({ theme, style, state, side, file, width: box.width * 2, height: box.height * 2 });
          process.stdout.write(`captured ${file} (${box.width}×${box.height} @2x)\n`);
          if (style === 'edge' && side === 'right' && (state === 'idle' || state === 'speaking')) {
            const hoverFile = `hover-${theme}-edge-${state}-right.png`;
            await page.hover('.sh-knob-face');
            await page.waitForTimeout(340);
            await page.screenshot({ path: join(OUT_DIR, hoverFile), omitBackground: true });
            results.push({
              theme,
              style,
              state: `${state} (hover)`,
              side,
              file: hoverFile,
              width: box.width * 2,
              height: box.height * 2,
            });
            process.stdout.write(`captured ${hoverFile} (hover)\n`);
          }
        }
      }
    }
  }

  for (const style of ['card', 'edge']) {
    const file = `opaque-dark-${style}-speaking-right.png`;
    const url = `${BASE}?capStyle=${style}&capVisual=speaking&capSide=right&capTheme=dark&capOpaque=1`;
    await page.setViewportSize({ width: 460, height: 180 });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('.hud-stage');
    const box = await page.locator('.hud-stage').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    });
    await page.setViewportSize(box);
    await page.waitForTimeout(420);
    await page.screenshot({ path: join(OUT_DIR, file), omitBackground: true });
    results.push({ theme: 'dark', style, state: 'speaking (opaque)', side: 'right', file, width: box.width * 2, height: box.height * 2 });
    process.stdout.write(`captured ${file} (opaque fallback)\n`);
  }

  const styleBlocks = THEMES.map((theme) =>
    sectionHtml(
      theme,
      STYLES.map((style) =>
        stateRow({ theme, style, results, docked: style === 'edge' }).replace(
          /<h3>.*?<\/h3>/,
          `<h3>${STYLE_LABEL[style]}</h3>`
        )
      ).join('')
    )
  ).join('');

  const sideBlocks = THEMES.map((theme) =>
    sectionHtml(
      theme,
      SIDES.map((side) => stateRow({ theme, style: 'edge', side, docked: true, results })).join('') +
        hoverRow({ theme, results })
    )
  ).join('');

  const sheetPage = await context.newPage();
  await sheetPage.setViewportSize({ width: 1180, height: 800 });

  const styleSheet = join(OUT_ROOT, `round-${ROUND}-styles.png`);
  await sheetPage.setContent(
    sheetHtml({
      kind: 'styles',
      title: `Pulse HUD — styles × states (round ${ROUND})`,
      subtitle:
        'Real overlay renderer, 2× device scale, transparent captures over a simulated desktop. Rows: card (400×72), mini (160×36), dock tab (30×68), orb (28×28); columns: idle, speaking, listening, paused, error. Both themes.',
      blocks:
        styleBlocks +
        sectionHtml('Opaque fallback', fallbackRow({ results }), ' (no transparency)'),
    })
  );
  await sheetPage.screenshot({ path: styleSheet, fullPage: true });

  const sideSheet = join(OUT_ROOT, `round-${ROUND}-docks.png`);
  await sheetPage.setContent(
    sheetHtml({
      kind: 'docks',
      title: `Pulse HUD — dock tab sides × states (round ${ROUND})`,
      subtitle:
        'The 30×68 dock tab on all four screen edges, shown against the simulated screen edge (the flat side is flush; a top/bottom dock keeps the 2 px reveal). Last row: hover, where the face grows 6 px toward the desktop inside the pre-allocated glow pad.',
      blocks: sideBlocks,
    })
  );
  await sheetPage.screenshot({ path: sideSheet, fullPage: true });

  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        round: ROUND,
        base: BASE,
        deviceScaleFactor: 2,
        captures: results,
        sheets: { styles: styleSheet, docks: sideSheet },
      },
      null,
      2
    )
  );

  await browser.close();
  console.log(`\n${results.length} captures in ${OUT_DIR}`);
  console.log(`styles sheet: ${styleSheet}`);
  console.log(`docks sheet:  ${sideSheet}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
