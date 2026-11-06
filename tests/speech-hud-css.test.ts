import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'src/renderer/styles/speech-hud.css'), 'utf8');

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped} \\{`, 'm').exec(css);
  if (!match) {
    throw new Error(`missing rule ${selector}`);
  }
  const start = match.index;
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

/**
 * Layout + design-language guards for the Pulse HUD. jsdom has no layout or
 * compositor, so the rules that carry the traits are pinned here; the real
 * renderer proof lives in tests/e2e/speech-bus.spec.ts and the capture loop
 * (scripts/hud-capture).
 */
describe('speech HUD fits its window', () => {
  it('keeps the card shrinkable and truncating', () => {
    expect(block('.sh-body')).toContain('min-width: 0');
    expect(block('.sh-status')).toContain('min-width: 0');
    expect(block('.sh-text')).toContain('min-width: 0');
    expect(block('.sh-text')).toContain('text-overflow: ellipsis');
    expect(block('.sh-text')).toContain('white-space: nowrap');
    expect(block('#speech-root')).toContain('overflow: hidden');
    expect(block('#speech-root')).toContain('width: 100%');
  });

  it('gives every dock control the same neutral chip', () => {
    expect(block('.hud-ghost')).toContain('width: 24px');
    expect(block('.hud-ghost:disabled')).toContain('opacity: 0.32');
    expect(block('.hud-playback')).toContain('display: inline-flex');
    expect(block('.sh-knob .hud-ghost')).toContain('background: color-mix');
    expect(block('.hud-ghost:hover:not(:disabled)')).toContain('background: color-mix');
  });

  it('keeps the wide dock line clipped and the controls in one row', () => {
    expect(block('.sh-knob-text')).toContain('display: none');
    expect(block('.sh-knob[data-wide="true"] .sh-knob-text')).toContain('-webkit-line-clamp: 3');
    expect(block('.sh-knob[data-wide="true"] .sh-knob-text')).toContain('var(--hud-text-scale');
    expect(block('.sh-knob[data-wide="true"] .sh-knob-actions')).toContain('flex-direction: row');
    expect(css).toContain('.sh-knob[data-wide="true"] .sh-knob-body .hud-wave');
    expect(css).toContain('.sh-knob[data-wide="true"] .sh-knob-body .hud-tab-bars');
  });

  it('fuses the normal and dictation rail into the HUD border', () => {
    expect(block('.sh-knob[data-dictating="true"]')).toContain('--hud-state: var(--hud-teal)');
    const rail = block('.sh-knob[data-wide="true"] .sh-knob-actions');
    expect(rail).toContain('left: 0');
    expect(rail).toContain('right: 0');
    expect(rail).toContain('bottom: 0');
    expect(rail).toContain('padding: 0');
    expect(rail).toContain('border-radius: var(--hud-radius, 10px)');
    expect(rail).toContain('overflow: hidden');
    expect(css).toContain(
      '.sh-knob[data-wide="true"] .sh-knob-actions .hud-ghost + .hud-ghost'
    );
    expect(css).toContain(
      '.sh-knob[data-wide="true"] .sh-knob-actions .hud-ghost:first-child'
    );
    expect(css).toContain('padding-left: 10px');
    expect(css).toContain(
      '.sh-knob[data-wide="true"] .sh-knob-actions .hud-ghost:last-child'
    );
    expect(css).toContain('padding-right: 10px');
    expect(css).toContain(
      '.sh-knob[data-wide="true"] .sh-knob-actions .hud-dock-action[data-action="translate-selection"]'
    );
    expect(css).toContain('.sh-knob-copy');
    expect(css).toContain('.sh-knob:hover .sh-knob-copy');
    const segment = block(
      '.sh-knob[data-wide="true"] .sh-knob-actions .hud-ghost'
    );
    expect(segment).toContain('flex: 1 1 0');
    expect(segment).toContain('height: 100%');
    expect(segment).toContain('background: transparent');
  });

  it('ships the Studio presets and honors motion off', () => {
    expect(css).toContain('.hud-stage[data-preset="aurora"] .hud-ring::before');
    expect(css).toContain('.hud-stage[data-preset="snake"] .hud-ring::before');
    expect(css).toContain('.hud-stage[data-preset="minimal"] .hud-wave');
    expect(css).toContain('.hud-stage[data-preset="terminal"] .hud-glass');
    expect(css).toContain('.sh-knob[data-hub-busy="true"]');
    expect(css).toContain('.sh-knob[data-mode="live"][data-visual="listening"]');
    expect(css).toContain('.sh-knob[data-mode="live"][data-visual="listening"]::after');
    expect(css).toContain('.hud-live-meter');
    expect(css).toContain('.sh-knob[data-content="single"] .sh-knob-text');
    expect(css).toContain('.sh-knob[data-content="empty"] .sh-knob-text');
    expect(css).toContain('.hud-stage[data-motion="off"] *');
    expect(css).toContain('.sh-knob[data-side="top"] .hud-ring');
    expect(css).toContain('animation: none !important');
  });
});

describe('Pulse glass surface', () => {
  it('deep-blurs the desktop behind the shape with a solid fallback', () => {
    expect(block('.hud-glass')).toContain('backdrop-filter: blur(14px)');
    expect(block('.hud-glass--opaque')).toContain('backdrop-filter: none');
    expect(block('.hud-glass--opaque')).toContain('var(--as-surface');
  });

  it('draws a hairline gradient border and a state-tinted halo', () => {
    expect(block('.hud-glass::before')).toContain('-webkit-mask-composite: xor');
    expect(block('.hud-glass::before')).toContain('linear-gradient');
    expect(block('.hud-glass::after')).toContain('var(--hud-state');
    expect(block('.hud-glass')).toContain('inset 0 1px 0 rgba(255, 255, 255, 0.22)');
  });

  it('carries the state palette on every style', () => {
    for (const visual of ['speaking', 'listening', 'paused', 'error']) {
      expect(css, visual).toContain(`[data-visual="${visual}"]`);
    }
    for (const style of ['sh-card', 'sh-orb', 'sh-knob']) {
      expect(css, style).toMatch(new RegExp(`\\.${style}\\[data-visual="speaking"\\]`));
    }
    expect(block(':root')).toContain('--hud-accent');
    expect(block(':root')).toContain('--hud-teal');
    expect(block(':root')).toContain('--hud-amber');
    expect(block(':root')).toContain('--hud-red');
  });

  it('animates state entry with the spring curve and breathes the glow', () => {
    expect(css).toMatch(/\.sh-card\[data-visual\],[\s\S]*?animation: hud-pop 200ms var\(--hud-ease\)/);
    expect(css).toContain('hud-pop');
    expect(css).toContain('hud-halo');
    expect(block('.hud-wave[data-visual="speaking"] .hud-wave-path')).toContain('animation');
    expect(block('.hud-wave[data-visual="listening"] .hud-wave-path')).toContain('animation');
  });
});

describe('Pulse shapes stay distinct without colour', () => {
  it('gives every state its own waveform path or bar structure', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/speech-overlay-react/SpeechHud.tsx'),
      'utf8'
    );
    expect(source).toContain('WAVE_PATHS');
    expect(source).toContain("paused: 'M8 8 H56'");
    expect(source).toContain("error: 'M0 8 L8 3 L16 13");
    expect(css).toContain('.sh-orb[data-visual="paused"] .sh-orb-core::before');
    expect(css).toMatch(/::before,\s*\n\.sh-orb\[data-visual="paused"\] \.sh-orb-core::after \{[\s\S]*?width: 2px/);
    expect(block('.hud-tab-bars[data-visual="paused"] .hud-tab-bar')).toContain('height: 9px');
    expect(block('.hud-tab-bars[data-visual="error"] .hud-tab-bar:nth-child(2)')).toContain('height: 4px');
  });

  it('keeps states legible with reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation: none !important');
    expect(reduced).toContain('.hud-tab-bars[data-visual="speaking"] .hud-tab-bar:nth-child(1)');
    expect(reduced).toContain('height: 14px');
  });
});

describe('Pulse geometry', () => {
  it('reserves glow padding around every shape (no clipped glow)', () => {
    expect(block('.hud-stage')).toContain('box-sizing: border-box');
    expect(block('.sh-card')).toContain('max-width: 400px');
    expect(block('.sh-card')).toContain('max-height: 72px');
    expect(block('.hud-stage')).toContain('max-width: 100%');
    expect(block('.sh-orb')).toContain('width: 28px');
    expect(block('.sh-orb')).toContain('border-radius: 50%');
  });

  it('keeps every style on the custom drag seam (clicks stay clickable)', () => {
    expect(block('.sh-card')).toContain('-webkit-app-region: no-drag');
    const knob = css.slice(css.indexOf('.sh-knob {\n  position: relative'));
    expect(knob.slice(0, knob.indexOf('}'))).toContain('-webkit-app-region: no-drag');
  });

  it('keeps the dock attached to the edge on hover', () => {
    expect(css).not.toMatch(/\.sh-knob\[data-side="[a-z]+"\]:hover \.sh-knob-face \{[^}]*transform:/);
    expect(block('.sh-knob:hover .sh-knob-face')).toContain('inset 0 0 0 1px');
  });
});
