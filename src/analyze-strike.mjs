// Analyze a buffer containing one strike, starting near its onset. The caller
// owns onset detection. This module has no microphone, DOM or fixture knowledge.
const MIN_FREQUENCY = 55;
const MAX_FREQUENCY = 1400;

export function centsBetween(frequency, reference) {
  return 1200 * Math.log2(frequency / reference);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// YIN-style cumulative normalized difference. Comparing the same number of
// samples at every lag avoids favoring long periods. Interpolation gives
// sub-sample precision without rounding the result to a musical note.
function estimateFrame(samples, sampleRate) {
  // Leave room for the right neighbor when interpolating the lowest pitch.
  const maximumLag = Math.ceil(sampleRate / MIN_FREQUENCY) + 2;
  const minimumLag = Math.floor(sampleRate / MAX_FREQUENCY);
  const comparisonLength = samples.length - maximumLag - 1;
  const difference = new Float64Array(maximumLag + 1);
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 0.001) return null;

  let cumulative = 0;
  for (let lag = 1; lag <= maximumLag; lag++) {
    let sum = 0;
    for (let index = 0; index < comparisonLength; index++) {
      const delta = samples[index] - samples[index + lag];
      sum += delta * delta;
    }
    cumulative += sum;
    difference[lag] = cumulative > 0 ? sum * lag / cumulative : 1;
  }

  for (let lag = Math.max(2, minimumLag); lag < maximumLag; lag++) {
    if (difference[lag] >= 0.12 || difference[lag] > difference[lag + 1]) continue;
    const left = difference[lag - 1];
    const center = difference[lag];
    const right = difference[lag + 1];
    const curvature = left - 2 * center + right;
    const offset = curvature === 0 ? 0 : (left - right) / (2 * curvature);
    const frequency = sampleRate / (lag + offset);
    if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) return null;
    return { frequency, periodicity: 1 - center, rms };
  }
  return null;
}

export function analyzeStrike(samples, sampleRate) {
  if (!(samples instanceof Float32Array)) throw new TypeError('Expected Float32Array samples');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError('Sample rate must be between 8000 and 192000 Hz');
  }
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new TypeError('Samples must be finite');
  }
  if (samples.some(sample => Math.abs(sample) >= 0.999)) {
    return { status: 'clipped' };
  }

  const frameLength = Math.round(sampleRate * 0.16);
  const hopLength = Math.round(sampleRate * 0.08);
  const attackLength = Math.round(sampleRate * 0.08);
  const frames = [];
  const end = Math.min(samples.length, Math.round(sampleRate));
  for (let start = attackLength; start + frameLength <= end; start += hopLength) {
    const frame = estimateFrame(samples.subarray(start, start + frameLength), sampleRate);
    if (frame) frames.push(frame);
  }
  if (frames.length < 3) return { status: 'insufficient-signal', acceptedFrames: frames.length };

  const frequency = median(frames.map(frame => frame.frequency));
  const spreadCents = Math.max(...frames.map(frame => Math.abs(centsBetween(frame.frequency, frequency))));
  if (spreadCents > 5) return { status: 'unstable', spreadCents, acceptedFrames: frames.length };
  return {
    status: 'measured',
    frequency,
    spreadCents,
    periodicity: median(frames.map(frame => frame.periodicity)),
    rms: median(frames.map(frame => frame.rms)),
    acceptedFrames: frames.length,
  };
}
