import { DEFAULTS } from './model.mjs';

export class ConflictError extends Error {
  constructor() { super('This record changed in another tab. Reload the saved version before editing it.'); }
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? new Error('Save cancelled'));
    transaction.onerror = () => {};
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openStore(name = 'free-handpan-tuner') {
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => {
    for (const name of ['instruments', 'reports', 'settings']) {
      request.result.createObjectStore(name, { keyPath: 'id' });
    }
  };
  const db = await requestResult(request);
  db.onversionchange = () => db.close();
  return new Store(db);
}

class Store {
  constructor(db) { this.db = db; }

  async all(name) {
    return requestResult(this.db.transaction(name).objectStore(name).getAll());
  }

  async load() {
    const transaction = this.db.transaction(['instruments', 'reports', 'settings']);
    const [instruments, reports, settings] = await Promise.all([
      requestResult(transaction.objectStore('instruments').getAll()),
      requestResult(transaction.objectStore('reports').getAll()),
      requestResult(transaction.objectStore('settings').get('preferences')),
    ]);
    return { instruments, reports, settings: { ...DEFAULTS, ...settings } };
  }

  async save(name, record) {
    const names = name === 'reports' ? ['instruments', 'reports'] : [name];
    const transaction = this.db.transaction(names, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(name);
    let saved;
    let conflict = false;
    let missingInstrument = false;
    const request = store.get(record.id);
    request.onsuccess = () => {
      const previous = request.result;
      if ((previous?.revision ?? 0) !== (record.revision ?? 0)) {
        conflict = true;
        transaction.abort();
        return;
      }
      const write = () => {
        saved = { ...structuredClone(record), revision: (previous?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString() };
        store.put(saved);
      };
      if (name === 'reports' && record.instrumentId) {
        const instrument = transaction.objectStore('instruments').get(record.instrumentId);
        instrument.onsuccess = () => {
          if (!instrument.result) { missingInstrument = true; transaction.abort(); return; }
          write();
        };
      } else write();
    };
    try { await done; }
    catch (error) {
      if (conflict) throw new ConflictError();
      if (missingInstrument) throw new Error('This handpan was removed in another tab. Export this draft, then reload saved records.');
      throw error;
    }
    return saved;
  }

  async remove(name, id, revision) {
    const names = ['instruments', 'reports'];
    const transaction = this.db.transaction(names, 'readwrite');
    const done = transactionDone(transaction);
    let conflict = false;
    const request = transaction.objectStore(name).get(id);
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== revision) { conflict = true; transaction.abort(); return; }
      transaction.objectStore(name).delete(id);
      if (name === 'reports' && request.result?.instrumentId) {
        const instrument = transaction.objectStore('instruments').get(request.result.instrumentId);
        instrument.onsuccess = () => {
          if (instrument.result?.baselineId === id) transaction.objectStore('instruments').put({
            ...instrument.result, baselineId: null, revision: instrument.result.revision + 1,
            updatedAt: new Date().toISOString(),
          });
        };
      }
      if (name === 'instruments') {
        const cursorRequest = transaction.objectStore('reports').openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          if (cursor.value.instrumentId === id) cursor.delete();
          cursor.continue();
        };
      }
    };
    try { await done; }
    catch (error) { if (conflict) throw new ConflictError(); throw error; }
  }

  async saveInstrumentAndReport(instrument, report) {
    // Discovery saves the profile and attaches the draft in a single commit.
    const transaction = this.db.transaction(['instruments', 'reports'], 'readwrite');
    const done = transactionDone(transaction);
    let conflict = false;
    const pending = [instrument, report];
    const saved = [];
    pending.forEach((record, index) => {
      const name = index === 0 ? 'instruments' : 'reports';
      const store = transaction.objectStore(name);
      const request = store.get(record.id);
      request.onsuccess = () => {
        if ((request.result?.revision ?? 0) !== (record.revision ?? 0)) {
          conflict = true; transaction.abort(); return;
        }
        saved[index] = { ...structuredClone(record), revision: (record.revision ?? 0) + 1,
          updatedAt: new Date().toISOString() };
        store.put(saved[index]);
      };
    });
    try { await done; }
    catch (error) { if (conflict) throw new ConflictError(); throw error; }
    return saved;
  }

  async importBackup(text) {
    const backup = validateBackup(text);
    const transaction = this.db.transaction(['instruments', 'reports'], 'readwrite');
    const done = transactionDone(transaction);
    const added = { instruments: 0, reports: 0, existing: 0 };
    for (const name of ['instruments', 'reports']) {
      for (const record of backup[name]) {
        const store = transaction.objectStore(name);
        const request = store.get(record.id);
        request.onsuccess = () => {
          // Re-importing is idempotent. Existing local records are retained.
          if (request.result) added.existing++;
          else { store.add(record); added[name]++; }
        };
      }
    }
    await done;
    return added;
  }
}

function text(value, label, maximum = 2000) {
  if (typeof value !== 'string' || value.length > maximum) throw new Error(`Invalid ${label}`);
  return value;
}

function number(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Invalid ${label}`);
  return value;
}

function date(value) {
  text(value, 'date', 40);
  if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid date');
  return value;
}

function identifier(value) {
  text(value, 'ID', 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || ['constructor', 'prototype', '__proto__'].includes(value)) {
    throw new Error('Invalid record identifier');
  }
  return value;
}

function field(value) {
  const targetMode = value.targetMode ?? (value.targetHz == null ? 'unknown' : 'hz');
  if (!['unknown', 'note', 'hz'].includes(targetMode)) throw new Error('Invalid target mode');
  if (!['ding', 'top', 'bottom'].includes(value.side)) throw new Error('Invalid field side');
  if (!Array.isArray(value.ratios) || value.ratios.length !== 2) throw new Error('Invalid partial ratios');
  const midi = number(value.midi, 'note', 0, 127);
  if (!Number.isInteger(midi)) throw new Error('Invalid note');
  return { id: identifier(value.id), label: text(value.label, 'field label', 100),
    midi, side: value.side, position: text(value.position ?? '', 'position', 100),
    targetMode, targetHz: value.targetHz == null ? null : number(value.targetHz, 'target', 10, 20000),
    ratios: value.ratios.map(ratio => ratio == null ? null : number(ratio, 'partial ratio', 1.01, 10)),
    unexpected: Boolean(value.unexpected) };
}

function fields(values) {
  if (!Array.isArray(values) || values.length > 512) throw new Error('Invalid fields');
  const result = values.map(field);
  if (new Set(result.map(value => value.id)).size !== result.length) throw new Error('Duplicate field ID');
  return result;
}

function take(value) {
  const result = { id: identifier(value.id), capturedAt: date(value.capturedAt), status: 'measured',
    frequency: number(value.frequency, 'frequency', 10, 20000),
    spreadCents: number(value.spreadCents, 'spread', 0, 2400),
    periodicity: number(value.periodicity, 'periodicity', 0, 1),
    rms: number(value.rms, 'signal level', 0, 2),
    acceptedFrames: number(value.acceptedFrames, 'frame count', 1, 10000),
    snrDb: number(value.snrDb ?? 20, 'signal to noise', -100, 200),
    partials: [] };
  if (value.partials != null) {
    if (!Array.isArray(value.partials) || value.partials.length > 2) throw new Error('Invalid partials');
    result.partials = value.partials.map(partial => partial == null ? null : {
      ratio: number(partial.ratio, 'ratio', 1.01, 10),
      frequency: number(partial.frequency, 'partial frequency', 10, 40000),
      relativeLevel: number(partial.relativeLevel, 'partial level', 0, 100),
    });
  }
  return result;
}

function record(value) {
  return { id: identifier(value.id), revision: number(value.revision ?? 0, 'revision', 0, 1e9),
    createdAt: date(value.createdAt), updatedAt: date(value.updatedAt ?? value.createdAt) };
}

function instrument(value) {
  return { ...record(value), name: text(value.name, 'name', 100), maker: text(value.maker ?? '', 'maker', 100),
    scale: text(value.scale ?? '', 'scale', 100), reference: number(value.reference, 'reference', 300, 600),
    fields: fields(value.fields), notes: text(value.notes ?? '', 'instrument notes'), archived: Boolean(value.archived),
    baselineId: value.baselineId == null ? null : identifier(value.baselineId) };
}

function report(value) {
  if (!['draft', 'final'].includes(value.status)) throw new Error('Invalid report status');
  const result = { ...record(value), instrumentId: value.instrumentId == null ? null : identifier(value.instrumentId),
    instrumentName: text(value.instrumentName, 'instrument name', 100), status: value.status,
    reference: number(value.reference, 'reference', 300, 600), tolerance: number(value.tolerance, 'tolerance', 1, 100),
    margin: number(value.margin, 'comparison margin', 1, 100), analysisVersion: text(value.analysisVersion, 'analysis version', 40),
    fields: fields(value.fields), readings: {}, rejected: number(value.rejected ?? 0, 'rejected count', 0, 1e9),
    notes: text(value.notes ?? '', 'report notes'), service: Boolean(value.service), input: null };
  if (value.input) {
    if (!['microphone', 'practice'].includes(value.input.kind)) throw new Error('Invalid input kind');
    result.input = { kind: value.input.kind, sampleRate: number(value.input.sampleRate, 'sample rate', 8000, 192000),
      label: text(value.input.label ?? '', 'input label', 200),
      ...(value.input.deviceId == null ? {} : { deviceId: text(value.input.deviceId, 'device ID', 300) }),
      echoCancellation: value.input.echoCancellation ?? null,
      noiseSuppression: value.input.noiseSuppression ?? null, autoGainControl: value.input.autoGainControl ?? null };
    for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) {
      if (result.input[key] !== null && typeof result.input[key] !== 'boolean') throw new Error('Invalid input setting');
    }
  }
  if (!value.readings || typeof value.readings !== 'object' || Array.isArray(value.readings)) throw new Error('Invalid readings');
  const knownFields = new Set(result.fields.map(item => item.id));
  if (Object.keys(value.readings).some(id => !knownFields.has(id))) throw new Error('A reading has no matching field');
  for (const item of result.fields) {
    const reading = Object.hasOwn(value.readings ?? {}, item.id) ? value.readings[item.id] : null;
    if (!reading) continue;
    if (!Array.isArray(reading.takes) || reading.takes.length > 10000) throw new Error('Invalid strikes');
    const takes = reading.takes.map(take);
    if (new Set(takes.map(take => take.id)).size !== takes.length) throw new Error('Duplicate take');
    if (takes.length && !takes.some(take => take.id === reading.bestTakeId)) throw new Error('Invalid best strike');
    Object.defineProperty(result.readings, item.id, { value: { takes, bestTakeId: reading.bestTakeId },
      enumerable: true, writable: true, configurable: true });
  }
  return result;
}

export function validateBackup(input) {
  if (input.length > 50 * 1024 * 1024) throw new Error('Backup is larger than 50 MB');
  const value = JSON.parse(input);
  if (value.format !== 'free-handpan-tuner' || value.version !== 1) throw new Error('Unsupported backup format or version');
  if (!Array.isArray(value.instruments) || !Array.isArray(value.reports)) throw new Error('Missing instruments or reports');
  const result = { instruments: value.instruments.map(instrument), reports: value.reports.map(report) };
  for (const name of ['instruments', 'reports']) {
    if (new Set(result[name].map(item => item.id)).size !== result[name].length) throw new Error(`Duplicate ${name} ID`);
  }
  const instruments = new Set(result.instruments.map(item => item.id));
  for (const item of result.reports) {
    if (item.instrumentId && !instruments.has(item.instrumentId)) throw new Error('A report is missing its instrument');
  }
  return result;
}

export function createBackup(instruments, reports) {
  return JSON.stringify({ format: 'free-handpan-tuner', version: 1,
    exportedAt: new Date().toISOString(), instruments, reports }, null, 2);
}
