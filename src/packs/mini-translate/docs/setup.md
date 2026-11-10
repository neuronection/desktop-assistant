# Setup

The translate pad ships **bundled and enabled** with Desktop
Assistant, but it needs a translation engine before it answers.

- **Engine prerequisite**: configure a provider under Tools →
  Translation (shared with the `/tr` command and the agent translate
  tool). Without a working engine the pad shows a typed error row —
  never a silent empty result. API keys live in the system keyring,
  never in the pack's config.
- **Default direction**: the pad opens with source *Automatic* and the
  target you last **applied** from its Settings button. With no applied
  choice it follows the default target under Tools → Translation, then
  English. The pack's card keeps both values as the starting point for
  that menu; one home per knob — engines stay under Tools →
  Translation.
- **Engine override**: the pad's Settings *Engine* row pins a mode for
  the pad only (`Configured default` follows Tools → Translation). The
  provider list, keys and failover order are still edited in one place
  — Tools → Translation.
- **Custom languages**: a code outside the family catalog is added from
  the pad's language field ("Use “xx” as a custom language") and lands
  in the same list the Tools → Translation editor manages — rename or
  remove it there. The engine must know the code; DeepL and
  LibreTranslate differ, so a mismatch surfaces as the pad's error row.
- **Debounce**: the pack's one live-tuning config key — *Auto-translate
  delay (ms)* — lives on the Mini-apps card (0–5000, default 1500) and is
  the only home for it (Tools → Translation points at it). It is not in
  the pad's menu: direction and engine are what change mid-session.
- **Enable/disable/remove**: Settings → Apps → Mini-apps → the
  Translate card. Removal is sticky (restore from the Mini-apps tab);
  disabling removes the `/tr` pad entry the pack contributes.
