# Audio analysis tests

From the repository root, serve the files with any static HTTP server and open
`tests/index.html`. Press **Run tests** to see every assertion and its measured
frequency error. The page uses native browser JavaScript and Web Audio only.
It requests no microphone permission and plays no sound through the speakers.

For automated execution, install Node.js 20 or newer and Chrome, then run
`node tests/run-browser-tests.mjs` from the repository root. Set `CHROME_BIN` to
the Chrome executable if it is unavailable as `google-chrome`. The runner uses
Node's standard library and Chrome's local debugging pipe. A nonzero exit code
means a failed assertion or an incomplete run. GitHub runs this same command on
changes to the analyzer, tests or workflow. There are no packages to install.

`simulate-handpan.mjs` builds an `OfflineAudioContext` graph of oscillators and
gain envelopes representing a fundamental, octave and twelfth. It renders
decaying strikes to an `AudioBuffer`. Ratios, relative amplitudes, decay times,
frequency drift and seeded background noise can vary independently. A
WaveShaperNode produces an intentionally clipped case. This approximates some
features of a struck field. Real shell coupling and room acoustics need later
recordings and device checks.

`analysis-tests.mjs` passes only rendered PCM samples and sample rate to the
analyzer in `src/analyze-strike.mjs`. Ground-truth frequencies stay in the test
code. Each successful pitch case must be within ±2 cents at both 44.1 and 48 kHz.
Other cases require rejection of silence, noise, clipping, unstable pitch and
short input. Test results appear in the page and in the automated runner's log.

The initial analyzer expects one buffer starting near a single strike. It skips
80 ms of attack, estimates periodicity in successive windows and requires
agreement across at least three windows. It reports measured Hz and quality
indicators without knowing a target pitch. Its initial search range is 55–1400
Hz. Live onset detection, individual partial measurements, instrument matching,
best-strike selection and reports still need implementation. A periodicity
estimate can confuse a missing fundamental or overlapping fields. This suite
establishes repeatable behavior for the simulated cases it contains. Real
microphones and real handpans require separate validation.

The application adds a streaming strike collector and spectral checks around
this initial estimator. `app-tests.mjs` covers the streaming path, upper partials,
ambiguous fundamentals, IndexedDB transactions, stale writes and import
idempotence. It exercises discovery, profile saving, reports, history, microphone
recovery and offline caching through the app’s normal UI. Automated runs use a
temporary browser profile and Chrome’s fake microphone. Manual runs may request
microphone permission. The integration flow cleans up its uniquely named test
records. The runner also reopens the app with network access disabled.
