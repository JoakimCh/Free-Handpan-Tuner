# Free Handpan Tuner

A browser PWA for discovering a handpan’s notes, checking its tuning and following
changes over time. Written in native JavaScript, HTML and CSS. There are no
packages to install and no build step.

## Open the app

Serve the repository as static files over HTTPS, or use localhost for development.
With Node.js 20 or newer installed, run this from the repository root.

```sh
node tools/serve.mjs
```

Open `http://127.0.0.1:8080`. Microphone access and service workers require a secure
context. A file opened directly from disk cannot load the app’s module and audio
pipeline reliably. Any HTTPS static host can serve this repository as published,
including hosting under a subdirectory. On GitHub Pages, select `main` and the
repository root in the repository’s Pages settings.

## Use it

- **Discover a handpan.** Start listening, play one physical field gently and let
  it ring. A clean strike is saved automatically. Repeat a field for more evidence.
  Review labels, ding/top/underside positions and targets before saving a profile.
  Targets start as unknown during discovery. Confirm them from the maker’s scale
  specification or choose the named note at the instrument’s reference pitch.
- **Check a saved instrument.** Open Handpans and choose Check tuning. Select a
  field manually when two fields share a pitch or automatic matching is uncertain.
  Every accepted strike is retained. The field list displays the cleanest take,
  and reports use the median of the accepted takes.
- **Recognize an instrument.** A discovery check lists saved handpans with matching
  note inventories. Confirm the instrument yourself. Matching scales can belong
  to different physical instruments.
- **Follow its history.** Save a report even if some fields remain unplayed. Reports
  show Hz, signed cents, strike counts and spread. Later reports show drift and a
  score for movement toward the target. Three agreeing strikes in both reports,
  matching inputs and matching targets are required for better/worse judgments.
  Choose a baseline, mark checks after service and inspect per-field trends.
- **Keep a backup.** Settings provides versioned JSON export and restore. Import
  validates the complete file before writing and retains existing local records.
  Repeated imports do not duplicate instruments or reports. Reports can also be
  printed or shared as plain text.
- **Try practice audio.** The Listen page offers a synthetic handpan. Its pads
  feed real Web Audio into the same AudioWorklet and analysis worker used by the
  microphone. These reports are marked as practice and compare separately from
  microphone reports.

After one successful online visit, the app and audio analysis assets are cached
for offline use. Install through the browser’s app menu, or Safari’s Share → Add
to Home Screen. The microphone starts only when requested and stops when the app
goes into the background. Audio stays in memory for analysis and is discarded.

## Measurement scope

The current fundamental detector searches approximately 55–1400 Hz. It skips the
impact transient and requires several stable windows. A spectral check rejects
some missing-fundamental cases and estimates peaks near configurable octave and
twelfth ratios. Upper-partial readings are experimental and do not influence
tuning judgments. Microphones, sympathetic fields and room acoustics can still
produce incorrect measurements. Accuracy can be improved independently of the
profile, report and storage features.

Default tolerance (10 cents) and minimum comparison margin (3 cents) are screening
settings. Use a maker’s tolerance when available. Repeat settled measurements in
similar conditions before asking a maker to assess possible detuning. Intended
targets, baseline measurements and current measurements are stored separately.

## Tests

```sh
node --test tests/model.test.mjs
node tests/run-browser-tests.mjs
```

The browser runner needs Chrome available as `google-chrome`, or at `CHROME_BIN`.
It uses Node’s standard library and Chrome’s local debugging pipe. It renders
known strikes with OfflineAudioContext, checks analysis and storage behavior,
exercises the real app UI, then disables network access and reopens the app. A
temporary browser profile is removed after the run. GitHub runs the checks on
relevant commits. No test framework or browser automation library is required.

For manual browser checks, open `tests/index.html` through the static server.
The integration flow creates uniquely named disposable records and removes its
own records afterwards. The automated microphone tests use Chrome’s fake media
device flags. Manual runs need microphone permission for the microphone checks.

## Source layout

| Files | Responsibility |
| --- | --- |
| `index.html`, `styles.css`, `src/views.mjs`, `src/editor.mjs` | Responsive, accessible interface and profile editor |
| `src/app.mjs` | Capture, editing and report workflows |
| `src/audio.mjs`, `src/capture-worklet.mjs` | Audio lifecycle, microphone selection and sample collection |
| `src/analysis-worker.mjs`, `src/strike-collector.mjs` | Worker processing, onset detection and strike segmentation |
| `src/analyze-strike.mjs`, `src/spectrum.mjs` | Periodicity, stability and upper-partial estimates |
| `src/model.mjs`, `src/storage.mjs` | Field identity, scoring, IndexedDB transactions and backups |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline caching and installation |

When changing cached assets, update the cache version in `sw.js`. Installed
clients receive a Save & reload banner after the new service worker is ready.
Update IndexedDB and backup schema versions explicitly when changing their
formats. The source is MIT licensed. The research and intended behavior are in
[the feature requirements](docs/feature-requirements.md).
