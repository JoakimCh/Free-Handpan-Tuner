import { analyzeStrike, centsBetween } from '../src/analyze-strike.mjs';
import { simulateHandpan } from './simulate-handpan.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cases = [
  { name: 'Low A1 ding', frequency: 55 },
  { name: 'A2 ding', frequency: 110 },
  { name: 'D3 field', frequency: 146.8323839587038 },
  { name: 'F3 field', frequency: 174.61411571650194 },
  { name: 'A3 field', frequency: 220 },
  { name: 'C4 field', frequency: 261.6255653005986 },
  { name: 'D4 field', frequency: 293.6647679174076 },
  { name: 'High D5 field', frequency: 587.3295358348151 },
  { name: 'High C6 field', frequency: 1046.5022612023945 },
  { name: 'D3 flat by 12 cents', frequency: 146.8323839587038 * 2 ** (-12 / 1200) },
  { name: 'D3 sharp by 17 cents', frequency: 146.8323839587038 * 2 ** (17 / 1200) },
  { name: 'A4 at 432 Hz', frequency: 432 },
  { name: 'Octave louder than fundamental', partials: [
    { ratio: 1, amplitude: 0.12, decay: 1.2 },
    { ratio: 2, amplitude: 0.36, decay: 0.8 },
    { ratio: 3, amplitude: 0.2, decay: 0.6 },
  ] },
  { name: 'Different partial decay times', partials: [
    { ratio: 1, amplitude: 0.25, decay: 1.6 },
    { ratio: 2, amplitude: 0.28, decay: 0.35 },
    { ratio: 3, amplitude: 0.18, decay: 0.25 },
  ] },
  { name: 'Quiet but clear strike', partials: [
    { ratio: 1, amplitude: 0.025, decay: 1.2 },
    { ratio: 2, amplitude: 0.015, decay: 0.8 },
    { ratio: 3, amplitude: 0.01, decay: 0.55 },
  ] },
  { name: 'Strike with seeded background noise', noise: 0.005 },
  { name: 'Silence', partials: [], expectedStatus: 'insufficient-signal' },
  { name: 'Noise alone', partials: [], noise: 0.08, expectedStatus: 'insufficient-signal' },
  { name: 'Clipped strike', clip: true, expectedStatus: 'clipped' },
  { name: 'Pitch moving during decay', endDetune: 80, expectedStatus: 'unstable' },
  { name: 'Too short to establish stability', duration: 0.15, expectedStatus: 'insufficient-signal' },
];

export async function runTests(onResult = () => {}) {
  const results = [];
  async function test(name, body) {
    let result;
    try {
      const details = await body();
      result = { name, passed: true, details };
    } catch (error) {
      result = { name, passed: false, details: error.message };
    }
    results.push(result);
    onResult(result);
  }

  for (const sampleRate of [44100, 48000]) {
    for (const fixture of cases) {
      await test(`${fixture.name} at ${sampleRate} Hz`, async () => {
        const audio = await simulateHandpan({ ...fixture, sampleRate });
        // The analysis receives only PCM samples and the actual sample rate.
        const result = analyzeStrike(audio.getChannelData(0), audio.sampleRate);
        const expectedStatus = fixture.expectedStatus ?? 'measured';
        assert(result.status === expectedStatus, `Expected ${expectedStatus}, got ${JSON.stringify(result)}`);
        if (expectedStatus !== 'measured') return result.status;
        const expectedFrequency = fixture.frequency ?? 146.8323839587038;
        const error = centsBetween(result.frequency, expectedFrequency);
        assert(Math.abs(error) <= 2, `Pitch error ${error.toFixed(3)} cents exceeds ±2 cents`);
        assert(result.acceptedFrames >= 3, 'Fewer than three accepted frames');
        return `${result.frequency.toFixed(3)} Hz, error ${error.toFixed(3)} cents`;
      });
    }
  }

  await test('Invalid sample rate is rejected', () => {
    let rejected = false;
    try { analyzeStrike(new Float32Array(1000), 0); }
    catch (error) { rejected = error instanceof RangeError; }
    assert(rejected, 'Expected RangeError');
    return 'RangeError';
  });
  await test('Non-finite PCM is rejected', () => {
    let rejected = false;
    try { analyzeStrike(new Float32Array([NaN]), 48000); }
    catch (error) { rejected = error instanceof TypeError; }
    assert(rejected, 'Expected TypeError');
    return 'TypeError';
  });
  return results;
}
