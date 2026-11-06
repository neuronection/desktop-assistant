# Voice

Voice has two independent halves: **speech input** (dictation) and
**spoken replies** (text-to-speech). Each is served by a model assigned in
**Settings → API Settings → Task Assignments**.

The Voice tab is split into two sub-tabs to match: **Input** (dictation
and post-processing) and **Replies** (spoken replies). Each sub-tab shows
its assigned task model — Transcription for Input, Speech for Replies —
with a **Configure models** link.

## Speech input (dictation)

Voice input is available once a transcription model is assigned to the
**Transcription** task. Until then it is off.

Four ways to dictate:

1. **Microphone button** in the composer toolbar — click to start, click
   **Stop recording** to finish.
2. **HUD quick question** — with the edge hub or the dot visible, click
   its mic button. It records in the HUD without ever opening the launcher;
   the rail becomes Quick actions, **Send** and **Stop** (on the dot the
   buttons sit in the hover strip). Send
   transcribes and sends the question to the **Voice questions**
   conversation; the reply is shown in the dock and spoken. Stop
   discards the recording.
3. **Push-to-talk** — hold `Control` while the launcher is focused; release
   to transcribe.
4. **Global hotkey** — assign a key combination to **Start Voice
   Recording** in **Settings → Hotkeys**.

### Voice settings

| Setting | What it does |
|---|---|
| **Enable voice input** | Master switch |
| **Transcription language** | Pin a language, or auto-detect. Pin it when auto-detect wobbles on accents or noise |
| **Live interim transcript** | Transcribes each phrase after a short pause while you keep talking |
| **Phrase pause** | How much silence closes a phrase before it is transcribed |
| **Send every** | Commits the transcript after this much continuous speech, even without a pause. Needed for auto-send on long dictations |
| **Mic gain** | Boosts the input level used by silence detection and the live bars. Raise it if phrases are never committed |

### Auto-send and transcript cleanup

Assign the **Voice post-processing** task to get one small-model call per
phrase that judges completeness and optionally cleans the text.

- **Auto-send completed phrases** — sends the dictation by itself when the
  judge decides a phrase is complete. It is **fail-closed**: any error,
  timeout, or low confidence means the transcript is *not* sent.
- **Judge phrases with** — choose who decides completeness:
  - **Decision model** — the model assigned to the **Boolean gate**
    decision slot (see [decision models](decision-models.md)). The status
    line shows the assigned model and its readiness, with an **Assign
    decision model** link into the API settings.
  - **Assigned Voice model** — the model assigned to the **Voice
    post-processing** task, falling back to the chat model. This skips the
    decision path entirely.
- **Fix text** — punctuation, capitals, spelling and filler removal.
- **Formatting** — paragraph breaks and light structure for long
  dictations.
- **Custom instructions** — appended to the post-processing instructions
  (technical terms, preferred spelling, style).
- **Attach recent context** — gives the post-processing model the last
  exchange so names and terms stay consistent. Slightly slower,
  negligible cost.

### During dictation

A voice indicator shows **Listening…** and then **Transcribing…**. Use
**Cancel dictation** to discard. `Escape` does not hide the window while
voice is active.

## Spoken replies (text-to-speech)

Assign a speech model to the **Speech** task. The model supplies the
speech engine; the voice is yours to choose.

### Speaking voice

| Setting | What it does |
|---|---|
| **Speaking voice** | **Provider default**, a preset for the assigned model, or a custom name you type into the search field |
| **Preview** | Speaks a short sample through the same speech player, using the current voice and speed |
| **Speak replies** | Reads every finished reply aloud. Off by default |
| **Speak when I ask in my message** | Also speaks a reply when your own message asks for it ("read that to me", "say it out loud"), even if **Speak replies** is off |

- Presets follow the assigned model: OpenAI-compatible names, Gemini's
  prebuilt voices (Kore, Puck, Charon, …), Piper's `female` / `male`, or
  Kokoro's voices when the model or base URL names Kokoro.
- A custom name is sent to the provider **unchanged** — useful for a
  self-hosted Kokoro/LocalAI/Piper server (`af_sky+af_bella`,
  `female-en`, …). Nothing is translated across providers.
- Switching to a provider that does not list the saved voice shows a
  warning and a **Reset to provider default** action; the value is never
  silently rewritten.
- **Preview** uses the draft voice and speed; nothing is saved until you
  click **Save**. Repeated previews play from the audio cache.
- A keyless local server on `localhost` or a private network needs no API
  key.
- Speed is disabled when the assigned model ignores it (Gemini); the
  control explains why.

Additional ways to speak:

- **Per-reply speak button** under a finished assistant message.
- **Speak selection** — speak selected text.
- **Standing voice mode** — say "speak aloud from now on" (or similar) and
  every following reply in that conversation is spoken; "stop speaking"
  clears it. A one-off "read that to me" still speaks only that one reply.
- **Per-conversation override** — the desktop inspector's **Speak replies**
  switch ("Speak all replies in this conversation") overrides the global
  setting for that conversation, even before the first message.
- **Speak rules** — under **Settings → Tools → Decision → Rules**, a rule
  can speak the reply or a fixed message when the decision model picks a
  matching command.

While speaking, a wave bar shows **Preparing audio…** / **Speaking…**
(and **Paused** once you pause it) with the chunk position (`3 of 12`),
plus pause/resume and **Stop speaking** controls in both windows. The
same state drives the speaking HUD and the tray. Playback continues even
if the window is hidden. Speech uses markdown-stripped, speakable text.

> Spoken replies always use the model assigned to the **Speech (tts)**
> task. Change it in **Settings → API Settings**; the voice is under
> **Settings → Voice → Replies**. To speak on a specific command instead,
> add a Speak rule under **Tools → Decision → Rules**.

## Speech from your desktop (selection speech)

Select text anywhere and press the **Speak Selected Text** hotkey
(default `Ctrl+Shift+S`, editable in Settings → Hotkeys) — the assistant
reads it without opening the launcher. Only the synthesis request goes to
your assigned speech model; the text itself is never persisted.

- **Speaking HUD.** A small card shows the current chunk while speech is
  prepared and plays. Pause/resume and stop are on the card; the same
  actions exist as the launcher wave bar, the tray menu and the pause/stop
  hotkeys — all of them drive ONE player, never two.
- **Pause.** Pausing during preparation is remembered: speech starts
  paused once the audio is ready and resumes on your command. Stop
  cancels the provider request instead of paying for the rest.
- **HUD posture.** Settings → Voice → Selection speech picks **While
  speaking, then fade** (default), **Keep on screen for this session** or
  **Never show it**. Audio plays either way; the last option only hides
  the card. Dismissing a pinned HUD returns it to the fading behaviour
  for the session.
- **HUD style.** The same controls come in four shapes with one visual
  language ("Pulse"): **Card** (the textual card with the spoken line and
  chunk progress), **Mini bar** (a 160×36 glass capsule with a smooth
  wave, a progress hairline and pause/stop), **Dock tab** (a 30×68 glass
  tab docked to the left, right, top or bottom screen edge; its body
  pauses/resumes, the glowing fill runs along the flat edge, and hovering
  it grows the face 6 px toward the desktop) and **Orb** (a 28 px presence
  orb — click it to stop speaking). Pick one under Settings → Voice →
  Selection speech; the **Position** controls follow the style — corners
  for the card/mini bar, dock side plus **Along the edge** for the tab, and
  a free-position hint with **Reset to bottom-right** for the orb — and the
  tray's **HUD style** submenu picks one directly. Mini bar, tab and orb can
  be dragged (the tab slides along its edge and snaps, the bar snaps to the
  nearest corner, the orb stays where you drop it) and the position is
  remembered. The orb keeps a 12 px safe distance from the screen edges
  and the taskbar, so it never ends up half on the border.
- **One surface at a time.** The HUD and the launcher never share the
  screen: opening the launcher hides the HUD (even with **Keep on screen**
  chosen); closing or minimizing the launcher brings it back while speech
  or a live session is active. The hidden HUD keeps playing audio, so the
  hand-off never interrupts what you are hearing.
- **States you can read without colour.** Speaking is the accent blue,
  listening is teal, paused is amber, errors flash red and idle is a dim
  neutral — and each state also changes the shape or motion: the orb gains
  a breathing halo, a dashed ring with an orbiting arc, pause bars, or an
  exclamation mark; the wave becomes a smooth line, a dashed line, a flat
  line or a zigzag; the dock tab's three bars go from dots to equal bars to
  a jagged silhouette. With **reduce motion** enabled the animation stops
  but those shapes remain. The glass surface blurs the desktop behind it;
  on systems without transparency the card and tab fall back to a solid
  panel.
- **Getting back to the app.** Right-click the mini bar, dock tab or orb
  for a short menu: **Open assistant**, **Speech settings…**, **HUD style**
  and **Keep on screen**. The card shows an **Open assistant** button next
  to pause/stop. The tray carries the same commands, so the HUD never traps
  you on the desktop.
- **Cost guard.** A selection longer than **Maximum selection length**
  (default 8,000 characters) is refused with a notice that names the
  limit, instead of synthesizing minutes of audio. **Hide the HUD from
  screen capture** (off by default) keeps the card out of screenshots and
  recordings.
- **Clipboard fallback.** When nothing is selected — or the desktop
  cannot expose a selection (Wayland without `wl-clipboard`) — use
  **Speak clipboard** from the tray. The app distinguishes "nothing was
  selected" from "this desktop cannot read the selection" instead of
  pretending.
- **Repeats are free.** Synthesized speech is cached locally, so selecting
  the same text again or replaying a reply plays instantly without a new
  model call. Usage and **Clear cache** live in Settings → Voice →
  Selection speech; turning the cache off, a full disk or a read-only
  profile never mutes speech — playback falls back to memory.
- **Replay.** **Recent speech** (the launcher ⋯ menu) lists this
  session's utterances with source, time, cached ratio and
  synthesis-call count, and can replay any of them. **Replay last
  speech** is also in the tray.
- **One owner.** While a live conversation runs it owns the speaker: live
  refuses selection speech and starting live stops it. While a reply is
  playing, a selection request takes over (an explicit keypress wins); a
  reply never interrupts your selection.

> Selection speech reads the X11 PRIMARY selection (or the `wl-paste`
> primary where available) — a passive read, never a copy keystroke sent
> into the focused window.

### Live conversation on the HUD

The textless HUD styles also show a live conversation — one presence
surface, never two (live owns the speaker while it runs, and the HUD reverts
to speech when the session ends):

| Live phase | HUD |
|---|---|
| Assistant speaking | Wave pulses in the accent colour (orb: breathing halo) |
| Mic open / listening | Wave turns **teal** and dashed (orb: dashed ring with an orbiting arc) |
| Preparing, paused or settling | Static and dimmed (orb: pause bars) |
| Session error | Red flash with an exclamation glyph on the orb |

The card style shows the live state (**Listening…**, **Working…**,
**Speaking…**) plus your last phrase and a short caption of the reply, with
interrupt/end buttons instead of speech progress. If a reply needs your
approval, the card turns amber with **Approval needed** and a notification
offers to open the assistant; approving happens in the launcher/desktop.

While live, the mini bar and the edge knob interrupt the reply when you
click their body and end the session from their always-visible square; the
dot ends the session when clicked. There is no pause control while live —
the tray and the Stop-Speaking chord keep their live meaning. The dot's
click is labelled **End live conversation** in that mode.

## Live conversation (hands-free)

The **Live** button in the composer turns the assistant into a continuous
voice loop: it listens, sends what you say, speaks the reply, and keeps
listening — no button presses between turns. You can also start it from
anywhere with the global **Start Live Conversation** hotkey (default
`Ctrl/Cmd+Alt+Space`, editable in Settings → General → Hotkeys) or the
tray's **Start live conversation** item. Live starts in the **HUD**: the
launcher is not shown (or is hidden once listening starts), and the HUD
shows the presence in your chosen style. The microphone and reply audio run
in a hidden engine, so closing or minimizing the launcher never stops the
session — open it anytime you want the transcript or an approval; the HUD
steps aside while it is open and returns when you close it. If the
microphone cannot start, the launcher opens with the error; the tray Start
stays retryable. **End live conversation** in the tray is enabled while a
session exists. It needs a speech model
assigned to the **Speech-to-text (STT)** and **Speech (tts)** tasks, and
uses the **active conversation** (turns append normally).

- **Interrupt by speech.** The mic stays open while the reply is spoken.
  A decision layer decides whether what it heard is a real interruption, a
  request to **end** the session, or something to ignore — echo of the
  assistant's own voice, background speech, a backchannel ("mm-hmm"), or
  noise. When in doubt it ignores, so a reply is never cut off by noise.
  Unambiguous words ("stop", "wait", "that's all", "goodbye") act at once.
- **Noise rejection is layered.** Silence, known Whisper hallucinations,
  decoding loops, and echo of the current sentence are filtered before the
  decision model is consulted; the model only judges the ambiguous rest.
- **Device behaviour.** With a headset (detected from the output device)
  the loop is full-duplex. On speakers, echo can make interruption
  unreliable, so it runs half-duplex (the mic closes while the reply
  plays) unless you turn on **Allow interruption on speakers**
  (Settings → Voice → Live). If echo is detected repeatedly mid-session
  it drops to half-duplex automatically and says so. You can also switch
  on the fly during a session with the **Voice interrupt** toggle next to
  the live status (on = full-duplex, off = half-duplex).
- **What you see.** The transcript box shows only the phrase you are
  saying **now**. Once the phrase is sent it stays in the same box for a
  few seconds with a delivered check at the end, so you can read back what
  was transcribed; while the assistant is speaking the box is hidden —
  during playback the mic is listening for an interruption, so raw echo is
  not shown. Phrases the loop ignores as echo, noise, or backchannel simply
  don't appear; turn on **Show what live mode ignores** (Settings → Voice →
  Live) for a brief, muted hint of what was filtered.
- **Quick interruption.** You don't have to speak over the assistant to
  stop it: press the global **Stop Speaking / Interrupt** hotkey (default
  `Ctrl/Cmd+Shift+Space`, editable in Settings → General → Hotkeys) — it
  works even when the window isn't focused. Press it once to stop the
  current reply (the session keeps listening), again to end live mode. With
  the window focused, `Escape` does the same: stop the reply → end live
  mode → hide. The **tray** menu offers **Stop speaking** and **End live
  conversation**. Interruption works while the reply is still being
  prepared (the mic stays open during speech synthesis) as well as during
  playback.
- **Turn timing.** Live mode ends a phrase sooner than dictation — the
  **Live phrase pause** (Settings → Voice → Live, default 0.4 s) — so
  turns feel snappier. The completeness check still decides whether a
  phrase is sent, and it fails closed (an unfinished phrase keeps
  listening).
- **Limits and failures.** A long reply is read aloud in short
  sentence-sized batches, synthesized one at a time as it plays, so an
  interruption stops paying for the rest. Beyond the **Spoken reply
  limit** (Settings → Voice → Live, default 4,000 characters; Unlimited
  reads all) the reading ends with a "shown on screen" notice.
  Transcription or speech hiccups show a notice and keep the session
  listening (they don't end it); a lost microphone or denied permission
  stops the session with an error. The **Live session turn limit** and the
  **End after silence** timeout (both Settings → Voice → Live; 0 = off)
  bound a session's length and idle time.
- **Ending.** Press **Live** again, say an end phrase, or just stop talking
  — the session ends after a pause and releases the mic. The microphone is
  live **only** during an explicit session (no wake word, no ambient
  capture).

> Live mode is a superset of the other voice controls: while a session is
> active the mic button, push-to-talk, and the per-conversation speak
> toggle are bypassed so a reply is never spoken twice. The auto-send
> judge and its fail-closed gate still apply.
