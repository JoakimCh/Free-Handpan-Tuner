// A Hann-windowed radix-2 spectrum, used to inspect the independently ringing
// partials of a strike. This is separate from the periodicity pitch estimate.
export function spectrum(samples, sampleRate) {
  const start = Math.round(sampleRate * 0.1);
  const length = Math.min(samples.length - start, Math.round(sampleRate * 0.7));
  if (length < 32) return null;
  const size = 2 ** Math.ceil(Math.log2(length));
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < length; index++) {
    real[index] = samples[start + index] * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (length - 1)));
  }
  for (let index = 1, reversed = 0; index < size; index++) {
    let bit = size >> 1;
    while (reversed & bit) { reversed ^= bit; bit >>= 1; }
    reversed ^= bit;
    if (index < reversed) [real[index], real[reversed]] = [real[reversed], real[index]];
  }
  for (let width = 2; width <= size; width *= 2) {
    const angle = -2 * Math.PI / width;
    for (let start = 0; start < size; start += width) {
      for (let offset = 0; offset < width / 2; offset++) {
        const cosine = Math.cos(angle * offset);
        const sine = Math.sin(angle * offset);
        const left = start + offset;
        const right = left + width / 2;
        const re = real[right] * cosine - imaginary[right] * sine;
        const im = real[right] * sine + imaginary[right] * cosine;
        real[right] = real[left] - re;
        imaginary[right] = imaginary[left] - im;
        real[left] += re;
        imaginary[left] += im;
      }
    }
  }
  const magnitudes = new Float64Array(size / 2);
  for (let index = 0; index < magnitudes.length; index++) {
    magnitudes[index] = Math.hypot(real[index], imaginary[index]);
  }
  return { magnitudes, binWidth: sampleRate / size };
}

export function spectralPeak(data, frequency, cents = 70) {
  if (!data) return null;
  const { magnitudes, binWidth } = data;
  const lower = Math.max(2, Math.floor(frequency * 2 ** (-cents / 1200) / binWidth));
  const upper = Math.min(magnitudes.length - 2, Math.ceil(frequency * 2 ** (cents / 1200) / binWidth));
  let peak = -1;
  for (let index = lower; index <= upper; index++) {
    if (magnitudes[index] > magnitudes[index - 1] && magnitudes[index] >= magnitudes[index + 1]
      && (peak < 0 || magnitudes[index] > magnitudes[peak])) peak = index;
  }
  if (peak < 0) return null;
  const left = Math.log(magnitudes[peak - 1] + 1e-30);
  const center = Math.log(magnitudes[peak] + 1e-30);
  const right = Math.log(magnitudes[peak + 1] + 1e-30);
  const curvature = left - 2 * center + right;
  const offset = curvature === 0 ? 0 : (left - right) / (2 * curvature);
  return { frequency: (peak + offset) * binWidth, amplitude: magnitudes[peak] };
}

export function inspectPartials(samples, sampleRate, frequency, ratios = [2, 3]) {
  const data = spectrum(samples, sampleRate);
  const fundamental = spectralPeak(data, frequency, 45);
  const peaks = ratios.map(ratio => ratio == null ? null : spectralPeak(data, frequency * ratio));
  const strongest = Math.max(fundamental?.amplitude ?? 0, ...peaks.map(peak => peak?.amplitude ?? 0));
  const supported = fundamental && fundamental.amplitude > strongest * 0.035;
  return {
    supported: Boolean(supported),
    partials: peaks.map((peak, index) => peak && peak.amplitude > strongest * 0.03 ? {
      ratio: ratios[index], frequency: peak.frequency, relativeLevel: peak.amplitude / Math.max(strongest, 1e-20),
    } : null),
  };
}
