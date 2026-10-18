# Setup

The translate pad ships **bundled and enabled** with Desktop
Assistant, but it needs a translation engine before it answers.

- **Engine prerequisite**: configure a provider under Tools →
  Translation (shared with the `/tr` command and the agent translate
  tool). Without a working engine the pad shows a typed error row —
  never a silent empty result. API keys live in the system keyring,
  never in the pack's config.
- **Debounce**: the pack's one config key — *Auto-translate delay
  (ms)* — lives on the Mini-apps card (0–5000, default 1500). One
  home per knob: engine choice itself stays under Tools →
  Translation.
- **Enable/disable/remove**: Settings → Apps → Mini-apps → the
  Translate card. Removal is sticky (restore from the Mini-apps tab);
  disabling removes the `/tr` pad entry the pack contributes.
