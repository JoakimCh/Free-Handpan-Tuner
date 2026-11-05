import { StrikeCollector } from './strike-collector.mjs';

let collector;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      collector = new StrikeCollector(data.sampleRate,
        result => self.postMessage({ type: 'result', result }),
        level => self.postMessage({ type: 'level', ...level }));
    } else if (data.type === 'ratios' && collector) {
      collector.ratios = data.ratios;
    } else if (data.type === 'samples' && collector) {
      collector.push(data.samples);
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
