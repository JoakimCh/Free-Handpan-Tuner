import { analyzeStrike } from './analyze-strike.mjs';
import { inspectPartials } from './spectrum.mjs';

export function analyzeHandpan(samples, sampleRate, noise = 0.0001, ratios = [2, 3]) {
  const result = analyzeStrike(samples, sampleRate);
  if (result.status !== 'measured') return result;
  const inspection = inspectPartials(samples, sampleRate, result.frequency, ratios);
  if (!inspection.supported) return { status: 'ambiguous' };
  return { ...result, partials: inspection.partials,
    snrDb: Math.max(-100, Math.min(200, 20 * Math.log10(result.rms / Math.max(noise, 1e-8)))) };
}

export class StrikeCollector {
  constructor(sampleRate, onResult, onLevel) {
    this.sampleRate = sampleRate;
    this.onResult = onResult;
    this.onLevel = onLevel;
    this.noise = 0.0001;
    this.previous = 0;
    this.elapsed = 0;
    this.levelElapsed = 0;
    this.chunks = [];
    this.length = 0;
    this.ratios = [2, 3];
  }

  push(samples) {
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const rms = Math.sqrt(energy / samples.length);
    this.elapsed += samples.length;
    this.levelElapsed += samples.length;
    const calibrating = this.elapsed < this.sampleRate * 0.4;
    const attack = !calibrating && rms > Math.max(0.006, this.noise * 4)
      && rms > this.previous * 2.1;
    if (calibrating || (!this.length && rms < this.noise * 3)) {
      this.noise = this.noise * 0.9 + rms * 0.1;
    }
    if (attack && this.length > this.sampleRate * 0.18) {
      this.chunks = [];
      this.length = 0;
      this.onResult({ status: 'overlap' });
    }
    if (attack || this.length) {
      this.chunks.push(samples);
      this.length += samples.length;
    }
    if (this.levelElapsed > this.sampleRate * 0.1) {
      this.levelElapsed = 0;
      this.onLevel({ rms, noise: this.noise, state: calibrating ? 'calibrating' : this.length ? 'capturing' : 'listening' });
    }
    this.previous = Math.max(rms, this.previous * 0.6);
    if (this.length >= this.sampleRate) {
      const strike = new Float32Array(this.length);
      let offset = 0;
      for (const chunk of this.chunks) { strike.set(chunk, offset); offset += chunk.length; }
      this.chunks = [];
      this.length = 0;
      this.onResult(analyzeHandpan(strike, this.sampleRate, this.noise, this.ratios));
    }
  }
}
