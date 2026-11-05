import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTake, createField, createReport, noteFrequency, parseNote, compareField,
  summarize, attachInstrument, recognitionMatches, resolveFields } from '../src/model.mjs';
import { createBackup, validateBackup } from '../src/storage.mjs';

function fixture() {
  const instrument = { id: crypto.randomUUID(), revision: 0, name: 'Test handpan', maker: '', scale: '',
    createdAt: new Date().toISOString(), reference: 440,
    fields: [createField(50, { side: 'ding', targetMode: 'note', targetHz: noteFrequency(50) })] };
  const report = createReport(instrument);
  report.input = { kind: 'practice', sampleRate: 48000, label: 'Test source', deviceId: 'practice' };
  return { instrument, field: instrument.fields[0], report };
}

function take(error, overrides = {}) {
  return { status: 'measured', frequency: noteFrequency(50) * 2 ** (error / 1200),
    periodicity: 0.999, spreadCents: 0.1, acceptedFrames: 10, rms: 0.1, snrDb: 35, ...overrides };
}

test('Enharmonic note parsing preserves octaves', () => {
  assert.equal(parseNote('Bb3'), 58);
  assert.equal(parseNote('C♯4'), 61);
  assert.equal(parseNote('B#3'), 60);
  assert.equal(parseNote('no'), null);
});

test('A clearer flat strike beats a noisier in-tune strike', () => {
  const { report, field } = fixture();
  let result = addTake(report, field.id, take(-12));
  result = addTake(result, field.id, take(0, { periodicity: 0.91, spreadCents: 3, snrDb: 12 }));
  assert.equal(summarize(result.readings[field.id]).best.frequency, take(-12).frequency);
  assert.equal(Object.keys(report.readings).length, 0);
});

test('Comparison separates movement from improvement and requires repeats', () => {
  const { report, field } = fixture();
  let previous = report;
  let current = structuredClone(report);
  for (let i = 0; i < 3; i++) {
    previous = addTake(previous, field.id, take(-12));
    current = addTake(current, field.id, take(-5));
  }
  const result = compareField(current, previous, field);
  assert.ok(Math.abs(result.drift - 7) < 1e-8);
  assert.ok(Math.abs(result.score - 7) < 1e-8);
  assert.equal(result.verdict, 'better');
  current.input = { kind: 'practice' };
  assert.equal(compareField(current, previous, field).verdict, 'inconclusive');
});

test('Unknown targets still permit measuring drift', () => {
  const { report, field } = fixture();
  field.targetHz = null;
  const previous = addTake(report, field.id, take(-12));
  const current = addTake(report, field.id, take(-5));
  const result = compareField(current, previous, field);
  assert.ok(Math.abs(result.drift - 7) < 1e-8);
  assert.equal(result.score, null);
});

test('Input comparison is independent of JSON key order and detects a different device', () => {
  const { report, field } = fixture();
  let previous = report;
  let current = structuredClone(report);
  for (let index = 0; index < 3; index++) {
    previous = addTake(previous, field.id, take(-12));
    current = addTake(current, field.id, take(-5));
  }
  current.input = Object.fromEntries(Object.entries(current.input).reverse());
  assert.equal(compareField(current, previous, field).verdict, 'better');
  current.input.deviceId = 'another-device';
  assert.equal(compareField(current, previous, field).verdict, 'inconclusive');
});

test('Editing the reference preserves old report targets', () => {
  const { report, instrument, field } = fixture();
  const updated = resolveFields(instrument.fields, 432);
  assert.equal(report.fields[0].targetHz, noteFrequency(field.midi, 440));
  assert.equal(updated[0].targetHz, noteFrequency(field.midi, 432));
});

test('Recognition ties stay visible and unisons require assignment', () => {
  const { report, instrument, field } = fixture();
  const observed = addTake(report, field.id, take(0));
  assert.equal(recognitionMatches(observed, [instrument, { ...instrument, id: crypto.randomUUID() }]).length, 2);
  instrument.fields.push(createField(50));
  const attached = attachInstrument(observed, instrument);
  assert.equal(attached.fields.filter(item => item.unexpected).length, 1);
});

test('Backup roundtrip preserves IDs and readings', () => {
  const { report, instrument, field } = fixture();
  const measured = addTake(report, field.id, take(-12));
  const restored = validateBackup(createBackup([instrument], [measured]));
  assert.equal(restored.reports[0].id, measured.id);
  assert.equal(restored.reports[0].readings[field.id].takes[0].frequency, take(-12).frequency);
  assert.equal(restored.instruments[0].fields[0].id, field.id);
});

test('Import rejects invalid frequencies and duplicate records before writing', () => {
  const { report, instrument, field } = fixture();
  const measured = addTake(report, field.id, take(0));
  measured.readings[field.id].takes[0].frequency = -1;
  assert.throws(() => validateBackup(createBackup([instrument], [measured])), /frequency/);
  assert.throws(() => validateBackup(createBackup([instrument, instrument], [])), /Duplicate/);
});
