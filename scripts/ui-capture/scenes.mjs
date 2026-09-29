/**
 * UI capture scene catalog for Desktop Assistant (repo-owned; the
 * family-standard sync script never overwrites this file).
 *
 * Captures attach to the REAL app over CDP (cdp mode): launch the app as
 * shown in docs/dev/visual-tour.md (vite on :3300 + electron with
 * --remote-debugging-port=9222 --demo), then run ./scripts/capture_ui.sh.
 * Viewports mirror the app's real window sizes (launcher bar, desktop
 * chat, settings) — viewport emulation resizes content, not the OS window.
 *
 * The chat scenes open the seeded demo conversations, which carry tool
 * traces and file artifacts — rendered items, not just prose (the demo
 * seeder fabricates the same turn metadata a live tool-using turn would).
 */
export const groups = [
  "Launcher",
  "Desktop chat",
  "Settings",
];

export const scenes = [
  {
    name: "launcher-chat",
    group: "Launcher",
    caption: "Launcher chat — the seeded demo conversation opens in the overlay itself.",
    narration: "Ask in place — your conversations live in the overlay, no window switch.",
    path: "/",
    fullPage: false,
    viewports: ["launcher-chat"],
    waitForSelector: "#app",
    interactions: [
      { action: "click", selector: "[title='More']" },
      { action: "click", selector: "button:has-text('History')" },
      { action: "click", selector: "text=Welcome to Desktop Assistant" },
      { action: "wait", ms: 1500 },
    ],
  },
  {
    name: "launcher",
    group: "Launcher",
    caption: "The hotkey launcher — summon the assistant from anywhere, ask, dismiss.",
    narration: "One hotkey summons the assistant over anything you are doing.",
    path: "/",
    fullPage: false,
    viewports: ["launcher"],
    waitForSelector: "#app",
    interactions: [
      { action: "fill", selector: "textarea", value: "Summarize what's on my screen" },
      { action: "wait", ms: 600 },
    ],
  },
  {
    name: "launcher-calc",
    group: "Launcher",
    caption: "Mini tool — the calculator evaluates live as you type in the launcher.",
    narration: "Mini tools turn the input into a focused surface — the calculator answers as you type.",
    path: "/",
    fullPage: false,
    viewports: ["launcher-calc"],
    waitForSelector: "#app",
    interactions: [
      { action: "fill", selector: "textarea", value: "/calc" },
      { action: "press", key: "Enter" },
      { action: "wait", ms: 600 },
      { action: "fill", selector: "textarea", value: "128 * 4.7 + 19.99" },
      { action: "wait", ms: 800 },
    ],
  },
  {
    name: "launcher-translate",
    group: "Launcher",
    caption: "Mini tool — the translate pad renders a live translation (local demo engine).",
    narration: "The translate pad renders live output — ask in one language, get another.",
    path: "/",
    fullPage: false,
    viewports: ["launcher-translate"],
    waitForSelector: "#app",
    interactions: [
      { action: "fill", selector: "textarea", value: "/tr" },
      { action: "press", key: "Enter" },
      { action: "wait", ms: 600 },
      { action: "fill", selector: "textarea", value: "Where is the nearest train station?" },
      { action: "wait", ms: 2500 },
    ],
  },
  {
    name: "desktop-chat",
    group: "Desktop chat",
    caption: "Desktop window — full conversations with the seeded demo history.",
    narration: "Open the window and your conversations are there — markdown, math, spoken replies.",
    path: "/?mode=desktop",
    viewports: ["desktop"],
    waitForSelector: "#app",
    interactions: [
      { action: "click", selector: "text=Welcome to Desktop Assistant" },
      { action: "wait", ms: 1200 },
    ],
  },
  {
    name: "desktop-tools",
    group: "Desktop chat",
    caption: "Tool trace — a conversation where the assistant ran tools and wrote a file artifact.",
    narration: "When tools run, you see every step — what was called, what came back, what was produced.",
    path: "/?mode=desktop",
    viewports: ["desktop"],
    waitForSelector: "#app",
    interactions: [
      { action: "click", selector: "text=Tools and approvals" },
      { action: "wait", ms: 1500 },
    ],
  },
  {
    name: "settings-general",
    group: "Settings",
    caption: "Settings — general pane of the settings window.",
    narration: "Everything is configurable — appearance, behavior, startup.",
    path: "/settings.html",
    viewports: ["settings"],
    waitForSelector: "#settings-root",
  },
  {
    name: "settings-api",
    group: "Settings",
    caption: "Settings — AI provider setup (BYOK).",
    narration: "Bring your own key: your AI provider, your data, your machine.",
    path: "/settings.html",
    viewports: ["settings"],
    waitForSelector: "#settings-root",
    interactions: [
      { action: "click", selector: "text=API" },
      { action: "wait", ms: 800 },
    ],
  },
];
