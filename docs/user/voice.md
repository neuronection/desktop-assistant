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
**Transcription (voice input)** task. Until then it is off.

Three ways to dictate:

1. **Microphone button** in the composer toolbar — click to start, click
   **Stop recording** to finish.
2. **Push-to-talk** — hold `Control` while the launcher is focused; release
   to transcribe.
3. **Global hotkey** — assign a key combination to **Start Voice
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
  - **Decision engine** — Jev, Needle or the chat model (see
    [decision models](decision-models.md)). Fast, and private with the
    local Needle model. The status line shows the resolved engine and its
    readiness, with a **Configure decision engine** link.
  - **Assigned Voice model** — the model assigned to the **Voice
    post-processing** task, falling back to the chat model. This skips the
    decision engine entirely.
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

Assign a speech model to the **Speech (TTS)** task. Speaking uses that
model and its own default voice — OpenAI's default, Gemini's `Kore`, and
so on. The old OpenAI-only voice/speed pickers are gone.

| Setting | What it does |
|---|---|
| **Speak replies** | Reads every finished reply aloud. Off by default |
| **Speak when I ask in my message** | Also speaks a reply when your own message asks for it ("read that to me", "say it out loud"), even if **Speak replies** is off |

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
  can speak the reply or a fixed message when the engine picks a matching
  command.

While speaking, a wave bar shows **Preparing audio…** / **Speaking…** with
a **Stop speaking** control in both windows. Playback continues even if
the window is hidden. Speech uses markdown-stripped, speakable text.

> Spoken replies always use the model assigned to the **Speech (tts)**
> task. Change it in **Settings → API Settings**. To speak on a specific
> command instead, add a Speak rule under **Tools → Decision → Rules**.

## Live conversation (hands-free)

The **Live** button in the composer turns the assistant into a continuous
voice loop: it listens, sends what you say, speaks the reply, and keeps
listening — no button presses between turns. It needs a speech model
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
- **Device behaviour.** With a headset the loop is full-duplex. On
  speakers, echo can make interruption unreliable, so it runs
  half-duplex (the mic closes while the reply plays) unless you opt into
  speaker barge-in. If echo is detected mid-session it drops to
  half-duplex and says so.
- **What you see.** The transcript box shows only the phrase you are
  saying **now**. Once the phrase is sent it is replaced by a brief
  **Sent: …** line (a few seconds) so you can read back what was
  transcribed, and while the assistant is speaking the box is hidden —
  during playback the mic is listening for an interruption, so raw echo is
  not shown. Phrases the loop ignores as echo, noise, or backchannel simply
  don't appear; turn on **Show what live mode ignores** (Settings → Voice →
  Replies) for a brief, muted hint of what was filtered.
- **Quick interruption.** You don't have to speak over the assistant to
  stop it: press the global **Stop Speaking / Interrupt** hotkey (default
  `Ctrl/Cmd+Shift+Space`, editable in Settings → General → Hotkeys) — it
  works even when the window isn't focused. Press it once to stop the
  current reply (the session keeps listening), again to end live mode. With
  the window focused, `Escape` does the same: stop the reply → end live
  mode → hide. The **tray** menu offers **Stop speaking** and **End live
  conversation**.
- **Ending.** Press **Live** again, say an end phrase, or just stop talking
  — the session ends after a pause and releases the mic. The microphone is
  live **only** during an explicit session (no wake word, no ambient
  capture).

> Live mode is a superset of the other voice controls: while a session is
> active the mic button, push-to-talk, and the per-conversation speak
> toggle are bypassed so a reply is never spoken twice. The auto-send
> judge and its fail-closed gate still apply.
