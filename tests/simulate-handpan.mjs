// Independent test fixture built with the browser's native audio graph.
// Frequencies, partial amplitudes and decay constants are explicit ground truth.
export async function simulateHandpan({
  sampleRate = 48000,
  duration = 1.2,
  frequency = 146.8323839587038,
  partials = [
    { ratio: 1, amplitude: 0.28, decay: 1.2 },
    { ratio: 2, amplitude: 0.18, decay: 0.8 },
    { ratio: 3, amplitude: 0.12, decay: 0.55 },
  ],
  noise = 0,
  seed = 123456,
  clip = false,
  endDetune = 0,
} = {}) {
  const context = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);
  const mix = context.createGain();
  mix.connect(context.destination);
  const attack = 0.006;
  for (const partial of partials) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const hz = frequency * partial.ratio * 2 ** ((partial.cents ?? 0) / 1200);
    oscillator.frequency.setValueAtTime(hz, 0);
    oscillator.frequency.exponentialRampToValueAtTime(hz * 2 ** (endDetune / 1200), duration);
    envelope.gain.setValueAtTime(0, 0);
    envelope.gain.linearRampToValueAtTime(partial.amplitude, attack);
    envelope.gain.exponentialRampToValueAtTime(
      Math.max(1e-8, partial.amplitude * Math.exp(-(duration - attack) / partial.decay)), duration,
    );
    oscillator.connect(envelope).connect(mix);
    oscillator.start();
    oscillator.stop(duration);
  }

  if (noise > 0) {
    const buffer = context.createBuffer(1, context.length, sampleRate);
    const data = buffer.getChannelData(0);
    let state = seed >>> 0;
    for (let index = 0; index < data.length; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[index] = (state / 2 ** 32 * 2 - 1) * noise;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(mix);
    source.start();
  }

  if (clip) {
    mix.disconnect();
    const shaper = context.createWaveShaper();
    shaper.curve = new Float32Array([-1, -1, -1, 0, 1, 1, 1]);
    mix.connect(shaper).connect(context.destination);
  }
  return context.startRendering();
}
