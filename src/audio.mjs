export class AudioCapture {
  constructor(onResult, onLevel, onInterrupted) {
    this.onResult = onResult;
    this.onLevel = onLevel;
    this.onInterrupted = onInterrupted;
    this.generation = 0;
    this.running = false;
  }

  async start(kind = 'microphone', deviceId = '') {
    const generation = ++this.generation;
    if (!window.isSecureContext) throw new Error('Open this app over HTTPS or localhost to use audio.');
    if (!window.AudioContext || !window.AudioWorkletNode || !window.Worker) {
      throw new Error('Live analysis needs Web Audio, AudioWorklet and Workers. Try a current browser.');
    }
    const context = new AudioContext();
    this.context = context;
    try {
      await context.resume();
      if (!context.audioWorklet) throw new Error('AudioWorklet is unavailable in this browser.');
      let descriptor;
      if (kind === 'microphone') {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          channelCount: { ideal: 1 }, echoCancellation: false,
          noiseSuppression: false, autoGainControl: false,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        } });
        if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); throw new DOMException('Cancelled', 'AbortError'); }
        this.stream = stream;
        const track = stream.getAudioTracks()[0];
        const settings = track.getSettings();
        track.onended = () => this.interrupt('The microphone disconnected. Start again to select an input.');
        this.source = context.createMediaStreamSource(stream);
        descriptor = { kind, sampleRate: context.sampleRate, label: track.label,
          echoCancellation: settings.echoCancellation ?? null, noiseSuppression: settings.noiseSuppression ?? null,
          autoGainControl: settings.autoGainControl ?? null };
      } else {
        this.source = context.createGain();
        descriptor = { kind: 'practice', sampleRate: context.sampleRate, label: 'Web Audio practice handpan',
          echoCancellation: null, noiseSuppression: null, autoGainControl: null };
      }
      await context.audioWorklet.addModule(new URL('./capture-worklet.mjs', import.meta.url));
      if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
      this.worker = new Worker(new URL('./analysis-worker.mjs', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'result') this.onResult(data.result);
        if (data.type === 'level') this.onLevel(data);
        if (data.type === 'error') this.interrupt(data.message);
      };
      this.worker.onerror = () => this.interrupt('The analysis worker stopped. Please start listening again.');
      this.worker.postMessage({ type: 'init', sampleRate: context.sampleRate });
      this.worklet = new AudioWorkletNode(context, 'handpan-capture');
      this.worklet.onprocessorerror = () => this.interrupt('Audio capture stopped. Please start again.');
      this.worklet.port.onmessage = ({ data }) => {
        this.worker?.postMessage({ type: 'samples', samples: data }, [data.buffer]);
      };
      this.source.connect(this.worklet).connect(context.destination);
      context.onstatechange = () => {
        if (this.running && context.state !== 'running') this.interrupt('Audio was interrupted. Tap Start listening to resume.');
      };
      this.running = true;
      if (navigator.wakeLock) {
        navigator.wakeLock.request('screen').then(lock => {
          if (generation === this.generation) this.wakeLock = lock;
          else lock.release();
        }).catch(() => {});
      }
      return descriptor;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  setRatios(ratios) { this.worker?.postMessage({ type: 'ratios', ratios }); }

  play(frequency, audible = false) {
    if (!this.running || this.stream) return;
    const now = this.context.currentTime;
    for (const [ratio, amplitude, decay] of [[1, 0.27, 1.2], [2, 0.17, 0.8], [3, 0.11, 0.55]]) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.frequency.value = frequency * ratio;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(amplitude, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.00001, now + decay * 3);
      oscillator.connect(gain).connect(this.source);
      if (audible) gain.connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + decay * 3);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }

  interrupt(message) {
    this.stop();
    this.onInterrupted(message);
  }

  async stop() {
    this.generation++;
    this.running = false;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
    this.worker?.terminate();
    this.worker = null;
    this.worklet?.disconnect();
    this.worklet?.port.close();
    this.worklet = null;
    this.source?.disconnect();
    this.source = null;
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    if (this.context) {
      this.context.onstatechange = null;
      await this.context.close().catch(() => {});
      this.context = null;
    }
  }
}

export function audioError(error) {
  const messages = {
    NotAllowedError: 'Microphone access was denied. Allow microphone access in your browser’s site settings, then start again.',
    NotFoundError: 'No microphone was found. Connect an input or try Practice audio.',
    NotReadableError: 'The microphone is busy or unavailable. Close other recording apps and try again.',
    OverconstrainedError: 'That input is unavailable. Choose Default microphone and try again.',
  };
  return messages[error.name] ?? error.message;
}
