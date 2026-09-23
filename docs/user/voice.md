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
  post-processing model judges a phrase complete. It is **fail-closed**:
  any error, timeout, or low confidence means the transcript is *not*
  sent. The same decision runs through the decision engine's
  `utterance-gate` point when one is enabled.
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
- **Speak rules** — under **Settings → Tools → Decision → Rules**, a rule
  can speak the reply or a fixed message when the engine picks a matching
  command.

While speaking, a wave bar shows **Preparing audio…** / **Speaking…** with
a **Stop speaking** control in both windows. Playback continues even if
the window is hidden. Speech uses markdown-stripped, speakable text.

> Spoken replies always use the model assigned to the **Speech (tts)**
> task. Change it in **Settings → API Settings**. To speak on a specific
> command instead, add a Speak rule under **Tools → Decision → Rules**.
