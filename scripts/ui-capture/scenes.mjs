/**
 * UI capture scene catalog for Desktop Assistant (repo-owned; the
 * family-standard sync script never overwrites this file).
 *
 * Captures attach to the REAL app over CDP (cdp mode). The reproducible
 * recipe — fresh demo workspace + the local scripted assistant/search/
 * translate services — is scripts/ui-capture/run-demo-capture.sh.
 *
 * These scenes are a storyboard: each scene is a chapter, each beat is a
 * frame (actions → wait → screenshot) with its own GIF dwell time. The
 * launcher viewports are auto-height: the runner mirrors the app's real
 * content-driven window size before every frame, so chrome changes never
 * clip a shot. Desktop/settings use fixed window sizes.
 */
export const groups = [
  "Launcher",
  "Tools",
  "Commands",
  "Mini apps",
  "Desktop",
  "Settings",
];

export const scenes = [
  {
    name: "launcher-ask",
    group: "Launcher",
    caption: "Ask from the launcher — type, send, and the answer streams in place.",
    narration: "One hotkey summons the assistant over anything you are doing. Type a question and the answer streams right in the launcher.",
    path: "/",
    fullPage: false,
    viewports: ["launcher-ask"],
    waitForSelector: "#app",
    beats: [
      {
        id: "typing-question",
        caption: "Type the question.",
        actions: [{ action: "fill", selector: "textarea", value: "How do I take a" }],
        settleMs: 150,
        holdMs: 700,
      },
      {
        id: "typing-full",
        caption: "The composer grows with the draft.",
        actions: [{ action: "fill", selector: "textarea", value: "How do I take a screenshot?" }],
        settleMs: 200,
        holdMs: 800,
      },
      {
        id: "thinking",
        caption: "Send — the turn starts in place.",
        actions: [
          { action: "press", selector: "textarea", key: "Enter" },
          { action: "wait", ms: 250 },
        ],
        settleMs: 100,
        holdMs: 1100,
      },
      {
        id: "streaming",
        caption: "The answer streams into the launcher.",
        waitForSelector: "text=microphone.",
        settleMs: 150,
        holdMs: 1300,
      },
      {
        id: "answer",
        caption: "Done — the answer, the conversation meta and the composer stay in one place.",
        waitForSelector: "text=right away.",
        settleMs: 300,
        holdMs: 2600,
        still: true,
      },
    ],
  },
  {
    name: "launcher-search",
    group: "Tools",
    caption: "Tools — a web search runs with visible steps, then the answer cites its sources.",
    narration: "Ask something current. The assistant searches the web, shows every step, and answers with sources — here against a local mock search, so the demo stays deterministic.",
    path: "/",
    fullPage: false,
    viewports: ["launcher-search"],
    waitForSelector: "#app",
    beats: [
      {
        id: "typing",
        caption: "Ask a question that needs the web.",
        actions: [{ action: "fill", selector: "textarea", value: "What's new in GNOME 49?" }],
        settleMs: 150,
        holdMs: 700,
      },
      {
        id: "thinking",
        caption: "Send — the trace strip shows the live turn.",
        actions: [
          { action: "press", selector: "textarea", key: "Enter" },
          { action: "wait", ms: 300 },
        ],
        settleMs: 100,
        holdMs: 1000,
      },
      {
        id: "tool",
        caption: "web_search runs — one visible step, no hidden magic.",
        waitForSelector: "text=web_search",
        settleMs: 250,
        holdMs: 1300,
      },
      {
        id: "answer",
        caption: "The answer lands with its sources.",
        waitForSelector: "text=Flathub",
        settleMs: 300,
        holdMs: 2400,
        still: true,
      },
      {
        id: "trace",
        caption: "Open the trace: the search query and every step are inspectable.",
        actions: [
          { action: "click", selector: "[title='Show trace details']" },
          { action: "wait", ms: 400 },
          { action: "click", selector: "button[aria-label='web_search details']" },
        ],
        settleMs: 400,
        holdMs: 2000,
      },
    ],
  },
  {
    name: "command-palette",
    group: "Commands",
    caption: "Slash commands — the palette opens from the composer and filters as you type.",
    narration: "Type a slash and the command palette opens in place — tools, settings and mini apps, one keystroke away.",
    path: "/",
    fullPage: false,
    viewports: ["palette"],
    waitForSelector: "#app",
    beats: [
      {
        id: "open",
        caption: "Type / to open the palette.",
        actions: [{ action: "fill", selector: "textarea", value: "/" }],
        settleMs: 500,
        holdMs: 1600,
        still: true,
      },
      {
        id: "filter",
        caption: "Keep typing to filter.",
        actions: [{ action: "fill", selector: "textarea", value: "/tr" }],
        settleMs: 500,
        holdMs: 1600,
      },
    ],
  },
  {
    name: "launcher-calc",
    group: "Mini apps",
    caption: "Mini apps — the calculator evaluates live as you type.",
    narration: "Mini tools take over the input: the calculator answers as you type, no second app.",
    path: "/",
    fullPage: false,
    viewports: ["launcher-calc"],
    waitForSelector: "#app",
    beats: [
      {
        id: "open",
        caption: "Open the calculator with /calc.",
        actions: [
          { action: "fill", selector: "textarea", value: "/calc" },
          { action: "press", selector: "textarea", key: "Enter" },
        ],
        settleMs: 500,
        holdMs: 1100,
      },
      {
        id: "result",
        caption: "The result updates live.",
        actions: [{ action: "fill", selector: "textarea", value: "128 * 4.7 + 19.99" }],
        waitForSelector: "text=621.59",
        settleMs: 300,
        holdMs: 2200,
        still: true,
      },
    ],
  },
  {
    name: "launcher-translate",
    group: "Mini apps",
    caption: "Mini apps — the translate pad renders a live translation.",
    narration: "The translate pad runs in the launcher — ask in one language, get another, copy the result.",
    path: "/",
    fullPage: false,
    viewports: ["launcher-translate"],
    waitForSelector: "#app",
    beats: [
      {
        id: "open",
        caption: "Open the translate pad with /tr.",
        actions: [
          { action: "fill", selector: "textarea", value: "/tr" },
          { action: "press", selector: "textarea", key: "Enter" },
        ],
        settleMs: 500,
        holdMs: 1100,
      },
      {
        id: "result",
        caption: "Live translation, local demo engine.",
        actions: [{ action: "fill", selector: "textarea", value: "Where is the nearest train station?" }],
        waitForSelector: "text=Dónde",
        settleMs: 500,
        holdMs: 2200,
        still: true,
      },
    ],
  },
  {
    name: "desktop-tools",
    group: "Desktop",
    caption: "Desktop window — the full conversation with tool steps and artifacts.",
    narration: "Open the full window when the conversation deserves room: transcripts, tool steps, artifacts, voice.",
    path: "/?mode=desktop",
    viewports: ["desktop"],
    waitForSelector: "#app",
    beats: [
      {
        id: "conversation",
        caption: "A tool-using conversation, with its trace and artifacts.",
        actions: [
          { action: "click", selector: "text=Tools and approvals" },
          { action: "wait", ms: 1200 },
        ],
        settleMs: 400,
        holdMs: 2600,
        still: true,
      },
    ],
  },
  {
    name: "settings-ai",
    group: "Settings",
    caption: "Settings — the AI tab: configured providers, models and task assignments, plus the preset catalog for every supported service.",
    narration: "Bring your own key. The AI tab holds providers, models and per-task assignments — and one catalog covers every supported service, from hosted APIs to local Ollama.",
    path: "/settings.html",
    viewports: ["settings"],
    waitForSelector: "#settings-root",
    beats: [
      {
        id: "providers",
        caption: "AI settings — configured providers and the default model.",
        actions: [
          { action: "click", selector: "text=API Settings" },
          { action: "wait", ms: 800 },
        ],
        settleMs: 500,
        holdMs: 2200,
      },
      {
        id: "add-provider",
        caption: "Add a provider — presets for every supported service, hosted or local.",
        actions: [
          { action: "click", selector: "text=Add New Provider" },
          { action: "wait", ms: 900 },
        ],
        settleMs: 500,
        holdMs: 2800,
        still: true,
      },
    ],
  },
];
