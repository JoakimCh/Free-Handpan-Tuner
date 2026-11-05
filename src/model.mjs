import { centsBetween } from './analyze-strike.mjs';

export const ANALYSIS_VERSION = '2.0';
export const DEFAULTS = { reference: 440, tolerance: 10, margin: 3, theme: 'system' };
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteFrequency(midi, reference = 440) {
  return reference * 2 ** ((midi - 69) / 12);
}

export function noteName(midi) {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function parseNote(text) {
  const match = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(text.trim());
  if (!match) return null;
  const accidental = { '': 0, '#': 1, '♯': 1, b: -1, '♭': -1 }[match[2]];
  return (Number(match[3]) + 1) * 12 + SEMITONES[match[1].toUpperCase()] + accidental;
}

export function nearestNote(frequency, reference = 440) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / reference));
  return { midi, name: noteName(midi), cents: centsBetween(frequency, noteFrequency(midi, reference)) };
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function createField(midi, options = {}) {
  return {
    id: crypto.randomUUID(), midi, label: noteName(midi), side: 'top', position: '',
    targetMode: 'unknown', targetHz: null, ratios: [2, 3], ...options,
  };
}

export function resolveFields(fields, reference) {
  return fields.map(field => ({
    ...field,
    targetHz: field.targetMode === 'note' ? noteFrequency(field.midi, reference) : field.targetHz,
  }));
}

export function createReport(instrument, settings = DEFAULTS) {
  return {
    id: crypto.randomUUID(), revision: 0, instrumentId: instrument?.id ?? null,
    instrumentName: instrument?.name ?? 'New handpan', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), status: 'draft', reference: instrument?.reference ?? settings.reference,
    tolerance: settings.tolerance, margin: settings.margin, analysisVersion: ANALYSIS_VERSION,
    fields: resolveFields(instrument?.fields ?? [], instrument?.reference ?? settings.reference),
    readings: {}, rejected: 0, notes: '', service: false, input: null,
  };
}

export function quality(take) {
  const snr = take.snrDb ?? 20;
  return take.periodicity * 60 + Math.min(60, snr) * 0.5
    - Math.min(50, take.spreadCents) * 2 + Math.min(12, take.acceptedFrames) * 0.2;
}

export function addTake(report, fieldId, measurement) {
  const copy = structuredClone(report);
  const take = {
    ...measurement, id: crypto.randomUUID(), capturedAt: new Date().toISOString(),
  };
  const reading = copy.readings[fieldId] ?? { takes: [], bestTakeId: null };
  reading.takes.push(take);
  const best = reading.takes.reduce((best, value) => quality(value) > quality(best) ? value : best);
  reading.bestTakeId = best.id;
  copy.readings[fieldId] = reading;
  return copy;
}

export function summarize(reading) {
  if (!reading?.takes.length) return null;
  const frequency = median(reading.takes.map(take => take.frequency));
  const spread = Math.max(...reading.takes.map(take =>
    Math.abs(centsBetween(take.frequency, frequency)) + take.spreadCents));
  const best = reading.takes.find(take => take.id === reading.bestTakeId) ?? reading.takes[0];
  return { frequency, spread, best, count: reading.takes.length };
}

export function matchingFields(report, frequency) {
  return report.fields.filter(field => {
    const expected = field.targetHz ?? noteFrequency(field.midi, report.reference);
    return Math.abs(centsBetween(frequency, expected)) <= 65;
  });
}

export function assessField(report, field) {
  const value = summarize(report.readings[field.id]);
  if (!value) return { status: 'unplayed', value: null, error: null };
  if (field.targetHz === null) return { status: 'unknown-target', value, error: null };
  const error = centsBetween(value.frequency, field.targetHz);
  return { status: Math.abs(error) <= report.tolerance ? 'within' : 'outside', value, error };
}

export function compareField(current, previous, field) {
  const now = summarize(current.readings[field.id]);
  const before = summarize(previous?.readings[field.id]);
  if (!now || !before) return null;
  const priorField = previous.fields.find(value => value.id === field.id);
  const drift = centsBetween(now.frequency, before.frequency);
  const matchingTarget = field.targetHz !== null && priorField?.targetHz !== null
    && Math.abs((priorField?.targetHz ?? 0) - field.targetHz) < 0.00001;
  const score = matchingTarget
    ? Math.abs(centsBetween(before.frequency, field.targetHz)) - Math.abs(centsBetween(now.frequency, field.targetHz))
    : null;
  const inputMatches = JSON.stringify(current.input) === JSON.stringify(previous.input);
  const margin = Math.max(current.margin, previous.margin, now.spread, before.spread);
  let reason = '';
  if (!matchingTarget) reason = 'Target changed or unknown';
  else if (current.analysisVersion !== previous.analysisVersion) reason = 'Analysis version changed';
  else if (!inputMatches) reason = 'Input or settings changed';
  else if (now.count < 3 || before.count < 3) reason = 'Repeat three clean strikes in each check';
  else if (now.spread > current.tolerance || before.spread > previous.tolerance) reason = 'Strikes disagree';
  let verdict = 'inconclusive';
  if (!reason) {
    verdict = Math.abs(score) <= margin ? 'similar' : score > 0 ? 'better' : 'worse';
  }
  return { drift, score, verdict, reason, margin };
}

export function recognitionMatches(report, instruments) {
  const observed = report.fields.filter(field => report.readings[field.id]?.takes.length);
  return instruments.filter(instrument => !instrument.archived).map(instrument => {
    const remaining = [...instrument.fields];
    let matched = 0;
    for (const field of observed) {
      const index = remaining.findIndex(candidate => candidate.midi === field.midi
        && (field.side !== 'ding' || candidate.side === 'ding'));
      if (index >= 0) { matched++; remaining.splice(index, 1); }
    }
    return { instrument, matched, observed: observed.length, total: instrument.fields.length };
  }).filter(match => match.matched > 0).sort((a, b) => b.matched - a.matched);
}

export function attachInstrument(report, instrument) {
  const copy = structuredClone(report);
  const fields = resolveFields(instrument.fields, instrument.reference);
  const readings = {};
  const used = new Set();
  for (const observed of copy.fields) {
    const candidates = fields.filter(field => field.midi === observed.midi && !used.has(field.id));
    // Unisons remain unexpected until the player assigns a physical field.
    const target = candidates.length === 1 ? candidates[0] : { ...observed, unexpected: true };
    if (candidates.length !== 1) fields.push(target);
    used.add(target.id);
    if (copy.readings[observed.id]) readings[target.id] = copy.readings[observed.id];
  }
  return { ...copy, instrumentId: instrument.id, instrumentName: instrument.name,
    reference: instrument.reference, fields, readings };
}

export function reportSummary(report) {
  const expected = report.fields.filter(field => !field.unexpected);
  const measured = expected.filter(field => summarize(report.readings[field.id]));
  const outside = measured.filter(field => assessField(report, field).status === 'outside');
  return { expected: expected.length, measured: measured.length, outside: outside.length };
}

export function serviceCandidates(current, previous) {
  if (!previous || current.input?.kind !== 'microphone' || current.createdAt.slice(0, 10) === previous.createdAt.slice(0, 10)) return [];
  return current.fields.filter(field => {
    const comparison = compareField(current, previous, field);
    const prior = previous.fields.find(item => item.id === field.id);
    return comparison && !comparison.reason && assessField(current, field).status === 'outside'
      && prior && assessField(previous, prior).status === 'outside';
  });
}
