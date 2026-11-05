# Free Handpan Tuner — feature requirements

A player meeting an unfamiliar handpan should be able to discover its notes in one pass. A player returning to their own handpan months later should be able to answer “Which field changed, by how much, and should I check it again?” Design for a phone resting beside the instrument, with both hands free after pressing **Start**.

## What the instrument asks of the tuner

A *tone field* is a playable area on the shell. One strike can produce a fundamental (the pitch used to name the note), an octave, and a twelfth (an octave plus a fifth). On studied instruments these modes are often close to frequency ratios of 1:2:3. Neighboring fields and the air cavity can also ring in response. A strong peak at twice the fundamental can therefore name the wrong octave, and a single tap can sound several pitches. Associate partials with the struck field. Require a separate strike before adding another field. [Rossing, Hang mode measurements](https://apps3.aps.org/aps/meetings/april09/presentations/W7Rossing.pdf) · [Sonores Acoustics, measured coupling between fields](https://www.sonoresacoustics.be/portfolio/handpan)

Layouts can include a central *ding*, surrounding fields, and underside notes. Two instruments with the same number of fields can put them in different places. Store a field ID, side and optional position independently of the pitch label. Allow any field count, duplicate pitches, and custom targets in hertz. Treat a scale name as an optional label. [Yishama, layout and bottom-note examples](https://www.yishama.com/virtual-pantam-playground/)

Temperature can shift a reading temporarily. Before a check, ask the player to let the instrument settle indoors, use a quiet room, place the phone in a repeatable position, and tap one field gently at a time. Offer “let the last note fade” or “move the phone a little farther away” when the audio calls for it. Save an optional condition note for the next session. [Elysian Instruments, heat and retuning](https://www.elysianinstruments.com/faq/) · [HandpanTune, repeatable checking procedure](https://handpantune.com/learn/how-to-check-handpan-tuning)

## Two ways to start

| | Discover a handpan | Check a saved handpan |
| --- | --- | --- |
| Start | Tap the ding, work around the top, then play any underside fields. Let the player choose their own order. | Choose a profile or start playing to get a shortlist of saved instruments. Confirm the instrument before attaching a report. |
| While playing | Show each accepted note with octave and measured Hz. A repeat improves the existing capture. Offer **Add separate field at this pitch**, rename, undo, and retry. | Show the expected fields, highlight the one just heard, and offer a manual field selector for unisons or uncertain matches. Keep unexpected tones visible for review. |
| Finish | Review the inventory, confirm which physical field each entry represents, and name the instrument. Confirm the intended pitches from a maker's specification when available. | Show measured, uncertain, unexpected and unplayed fields separately. Allow saving a partial report and returning to it. |

For recognition, compare the observed note names **and octaves** with saved inventories, including the ding when identified. Allow missing fields and modest drift. Display the evidence, for example “6 fields match both of your D Kurd handpans”. In a tie, ask for a distinguishing field or a manual choice. Even a complete identical layout can belong to two different instruments. Always offer **New handpan**. Discovery remains usable without a matching preset or a known tuning reference.

## What counts as a clean strike

1. Detect the onset against the current room noise. Skip the impact transient and collect a stable portion of the ringing sound before it fades into noise. Use enough cycles for the candidate pitch, including low dings.
2. Estimate fundamental pitch across several windows and inspect the spectrum for supporting partials. If a strong octave could equally be the fundamental, prompt a repeat on the selected field. Overlapping strikes, clipping and unstable estimates each get a specific retry message.
3. Rank usable strikes by signal above noise, pitch stability, usable duration and agreement on the fundamental. Exclude clipped or ambiguous takes. **Distance to the tuning target must never improve a strike’s quality rank.** A clear flat note is valuable evidence.
4. Keep the highest-quality measurement per physical field for the live display. A weaker repeat leaves it in place. Save the best take's measured Hz and quality indicators, accepted strike count, median and spread of accepted pitches. One good strike can identify a note. Ask for three independent, agreeing strikes before flagging drift. If clean takes disagree, show their spread and request another check.

The primary check measures the fundamental. Where separable, show octave and twelfth frequencies and their cents offsets from the field's expected ratios. Make those ratios editable for a maker-specific tuning. Mark unresolved or inapplicable partials explicitly. A stable fundamental and an unresolved octave should read “Fundamental within tolerance · octave unmeasured”. Validate partial recognition on real instruments before including it in a tuning judgment.

## Targets, change and service decisions

Default note naming to twelve-tone equal temperament at A4 = 440 Hz. Allow another reference such as 432 Hz, or an explicit Hz target per field. Show the reference while measuring. In discovery, the nearest note is a suggestion. Preserve measured Hz even if the player later corrects a label. Keep three distinct values: the intended target, the first trusted measurement the player marks as baseline, and the latest measurement. An unknown target still permits tracking drift from baseline.

| Report value | Calculation or rule | Player-facing meaning |
| --- | --- | --- |
| Tuning error | `1200 × log2(measured Hz / target Hz)`, using the median across accepted strikes | Signed cents, with “flat” or “sharp”. Show “target unknown” when appropriate. |
| Drift | `1200 × log2(current Hz / earlier Hz)` for the same physical field | Movement since the previous comparable report or a selected baseline. Positive means the pitch rose. |
| Change score | `abs(previous error) − abs(current error)`, using the same target | Positive means closer to target. Moving from −12 to −5 cents scores +7. Moving from −5 to +5 scores 0 despite a 10-cent rise. |
| Verdict | Compare absolute error with a displayed, configurable tolerance. Only call a change better or worse when it exceeds the repeatability margin derived from device tests and the two sessions’ strike spreads. | Within tolerance, outside tolerance, or inconclusive. Small changes read “within measurement variation”. |

Use a maker's tolerance when supplied. Label any app default as a screening setting and validate it before release. Show how many expected fields have comparable evidence (for example **7 of 9 checked, 1 outside tolerance**). Keep the largest repeatable deviation visible. Missing notes and uncertain strikes do not count as passes. A single outlier prompts a repeat. A field repeatedly outside its intended tolerance in two comparable, settled sessions prompts “Consider sending these reports to your maker.” With an unknown target, report movement and invite target confirmation. The player decides whether to request service.

## Instrument records and history

- **Instrument:** Stable ID, nickname, optional maker/model, scale label, tuning reference, physical field IDs and target definitions. Provide edit, archive and delete controls. Editing a profile preserves the original targets in older reports.
- **Report:** Instrument ID, timestamp, draft/final state, target and tolerance snapshot, field-level measurements and quality evidence, input settings where available, analysis version, and optional notes on room, placement or service. Save progress after each accepted field and finalize the report atomically.
- **Comparison:** Open on the previous comparable report for this instrument. Offer a dated history, a per-field trend in cents or Hz, and a selectable baseline. Mark service events so a player can start a post-service baseline while retaining earlier reports. Flag changed inputs or processing versions. Suppress better/worse verdicts when field identity, target or measurement method makes the comparison unreliable.
- **Ownership:** Keep measurements on device by default. Discard raw audio after analysis. Export and restore versioned JSON with stable IDs, reports and targets. Validate imports before writing, handle duplicate imports without duplicating history, and offer a human-readable report the player can print or send to a maker.

## Browser and interaction requirements

Ship static HTML, CSS and native JavaScript modules. All analysis runs locally. No third-party runtime, build tools, CDNs or account requirement.

| Area | Required behavior |
| --- | --- |
| Microphone | Start on an explicit tap over HTTPS. Use MediaDevices.getUserMedia and Web Audio. Prefer mono with echo cancellation, noise suppression and automatic gain disabled where supported. Record the actual settings available and use the AudioContext sample rate. Keep microphone monitoring silent. Stop tracks on Stop or exit. Handle denial, interruption and unavailable input with a recovery action. [Microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) · [Track settings](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings) |
| Analysis | Use AudioWorklet for time-sensitive sample collection. Keep expensive analysis and rendering off the audio callback. Feature-detect capture capabilities. Keep saved reports readable when live analysis is unavailable. [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet) |
| Offline and storage | Provide a web app manifest and service worker that caches all capture assets after the first successful online load. Store instruments and reports in IndexedDB. Handle storage failures visibly, request persistent storage where available, and provide backup export because browser data can be evicted. [Offline PWAs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation) · [Storage and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) |
| Phone and larger screens | Put note, octave, signed cents, confidence and listening state above the field list. Use large touch controls, text alongside color, and stable screen-reader announcements when a note locks. Support keyboard navigation. On wider screens show capture and inventory side by side. Keep Stop and Retry reachable in portrait. |

## Audio analysis tests

Start with executable tests of simulated handpan strikes using the native Web Audio API. Use an OfflineAudioContext graph with oscillators for the fundamental, octave and twelfth, each with its own amplitude and decay envelope. Render the graph to an AudioBuffer and feed its PCM samples and actual sample rate into the same analysis module that will later receive microphone samples. Keep expected frequencies and assertions entirely in the tests. [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext)

Cover low and high fields, sharp and flat offsets, a louder octave, different decay times and background noise at 44.1 and 48 kHz. Assert measured frequency against the known input in cents. Include silence, noise alone, clipping, changing pitch and a buffer too short to establish stability. Keep fixtures deterministic with seeded noise.

Provide a browser test page showing each assertion and a dependency-free runner using Node's standard library and headless Chrome, so results can be checked automatically in the repository. Begin with these analysis tests before building the player-facing app and UI. Grow the fixtures as more analysis behavior is implemented, including overlapping fields, ambiguous octaves and independently detuned partials.

Simulation establishes repeatable behavior under known inputs. Verify accuracy and repeatability separately with real handpans, microphones and mobile browsers before using the measurements for tuning-change or service judgments.

