import { AudioCapture, audioError } from './audio.mjs';
import { ANALYSIS_VERSION, DEFAULTS, addTake, attachInstrument, createField, createReport,
  matchingFields, nearestNote, noteFrequency, resolveFields, summarize } from './model.mjs';
import { ConflictError, createBackup, openStore } from './storage.mjs';
import { editorView, presetFields, readEditor } from './editor.mjs';
import { h, listenView, libraryView, historyView, reportView, settingsView, textReport } from './views.mjs';

const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const state = {
  instruments: [], reports: [], settings: { ...DEFAULTS }, draft: null, dirty: false,
  listening: false, starting: false, selectedField: '', sourceKind: 'microphone', deviceId: '', devices: [],
  lastMeasurement: null, lastFieldId: null, pendingMeasurement: null, undo: [], editor: null,
  showArchived: false, audible: false, captureMessage: '', trendField: '', compareId: '',
};
let store;
let queue = Promise.resolve();
let toastTimer;
let notesTimer;
let installPrompt;
let registration;
let applyingUpdate = false;
let audioAttempt = 0;
let routeKey = '';

const capture = new AudioCapture(
  measurement => {
    if (state.listening) enqueue(() => acceptMeasurement(measurement));
  },
  level => {
    const meter = document.querySelector('#input-level');
    if (meter) meter.value = Math.min(1, level.rms * 5);
    const status = document.querySelector('#live-state');
    if (status) status.textContent = { calibrating: 'Listening to the room…', capturing: 'Capturing the ring…', listening: 'Listening for a strike' }[level.state];
  },
  message => {
    audioAttempt++;
    state.listening = false;
    state.starting = false;
    state.captureMessage = message;
    showError(message);
    render();
  },
);

function currentRoute() {
  const [page = 'listen', id = ''] = location.hash.slice(1).split('/');
  return { page: page || 'listen', id };
}

function upsert(name, record) {
  const index = state[name].findIndex(value => value.id === record.id);
  if (index < 0) state[name].push(record);
  else state[name][index] = record;
}

function enqueue(task) {
  queue = queue.then(task).catch(error => { showError(error); render(); });
  return queue;
}

function showError(error) {
  const box = document.querySelector('#error');
  box.hidden = false;
  box.innerHTML = `${h(error.message ?? error)}${error instanceof ConflictError ? ' <button data-action="reload-saved">Back up & reload saved records</button>' : ''} <button data-action="dismiss-error" aria-label="Dismiss message">Dismiss</button>`;
}

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 5000);
}

function render() {
  const route = currentRoute();
  document.documentElement.dataset.theme = state.settings.theme;
  const navPage = ['report', 'resume'].includes(route.page) ? 'history' : route.page;
  document.querySelectorAll('[data-nav]').forEach(link => {
    const active = link.dataset.nav === navPage;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const focusId = document.activeElement?.id;
  const views = { listen: () => listenView(state), library: () => libraryView(state),
    history: () => historyView(state, route.id), report: () => reportView(state, route.id),
    settings: () => settingsView(state) };
  main.innerHTML = (views[route.page] ?? views.listen)();
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  document.documentElement.dataset.appReady = 'true';
  document.title = `${route.page === 'report' ? 'Tuning report' : route.page === 'library' ? 'Handpans' : route.page === 'history' ? 'History' : route.page === 'settings' ? 'Settings' : 'Listen'} · Free Handpan Tuner`;
}

async function load() {
  const records = await store.load();
  state.instruments = records.instruments;
  state.reports = records.reports;
  state.settings = records.settings;
}

async function persistDraft(report = state.draft) {
  if (!report) return;
  state.draft = report;
  try {
    const saved = await store.save('reports', report);
    state.draft = saved;
    upsert('reports', saved);
    state.dirty = false;
    const saveState = document.querySelector('#save-state');
    if (saveState) saveState.textContent = 'Draft saved on this device';
    return saved;
  } catch (error) {
    state.dirty = true;
    upsert('reports', state.draft);
    throw error;
  }
}

function rememberUndo() {
  state.undo.push(structuredClone(state.draft));
  if (state.undo.length > 20) state.undo.shift();
}

async function stopListening() {
  audioAttempt++;
  state.listening = false;
  state.starting = false;
  await capture.stop();
}

async function startReport(instrument = null, sourceKind = state.sourceKind) {
  clearTimeout(notesTimer);
  await stopListening();
  if (state.dirty) await persistDraft();
  state.draft = createReport(instrument, state.settings);
  state.sourceKind = sourceKind;
  state.selectedField = '';
  state.lastMeasurement = null;
  state.lastFieldId = null;
  state.pendingMeasurement = null;
  state.undo = [];
  state.captureMessage = '';
  await persistDraft();
  location.hash = '#listen';
  render();
}

async function resumeReport(id) {
  await stopListening();
  const report = state.reports.find(report => report.id === id);
  if (!report) { toast('This draft is unavailable.'); location.hash = '#history'; return; }
  if (report.status !== 'draft') { location.hash = `#report/${report.id}`; return; }
  if (state.dirty && state.draft?.id !== id) await persistDraft();
  state.draft = structuredClone(report);
  state.sourceKind = report.input?.kind ?? 'microphone';
  state.selectedField = '';
  state.lastMeasurement = null;
  state.lastFieldId = null;
  state.pendingMeasurement = null;
  state.undo = [];
  state.dirty = false;
  location.hash = '#listen';
  render();
}

async function toggleListening() {
  if (state.listening || state.starting) { await stopListening(); render(); return; }
  if (!state.draft) return;
  const attempt = ++audioAttempt;
  state.starting = true;
  state.captureMessage = '';
  document.querySelector('#error').hidden = true;
  render();
  try {
    // start() creates and resumes AudioContext within the button's activation.
    const input = await capture.start(state.sourceKind, state.deviceId);
    await enqueue(async () => {
      if (attempt !== audioAttempt || !capture.running || currentRoute().page !== 'listen') return;
      try {
        const hasTakes = Object.values(state.draft.readings).some(value => value.takes.length);
        if (hasTakes && (JSON.stringify(state.draft.input) !== JSON.stringify(input) || state.draft.analysisVersion !== ANALYSIS_VERSION)) {
          const instrument = state.instruments.find(item => item.id === state.draft.instrumentId);
          state.draft = createReport(instrument, state.settings);
          state.undo = [];
          state.lastMeasurement = null;
          toast('A new check was started for this input. The earlier draft is saved.');
        }
        state.draft.input = input;
        state.draft.analysisVersion = ANALYSIS_VERSION;
        await persistDraft();
        state.listening = true;
        state.starting = false;
        capture.setRatios(state.draft.fields.find(field => field.id === state.selectedField)?.ratios ?? [2, 3]);
        await refreshDevices();
        render();
      } catch (error) {
        await stopListening();
        throw error;
      }
    });
  } catch (error) {
    if (attempt !== audioAttempt) return;
    state.starting = false;
    state.listening = false;
    if (error.name !== 'AbortError') showError(audioError(error));
    render();
  }
}

async function acceptMeasurement(measurement) {
  if (!state.listening || !state.draft || state.draft.status !== 'draft') return;
  if (state.pendingMeasurement) return;
  if (measurement.status !== 'measured') {
    const messages = {
      clipped: 'The strike was too loud. Move the phone farther away and try gently.',
      unstable: 'The pitch moved during the ring. Let nearby fields fade and repeat.',
      ambiguous: 'The fundamental is unclear. Select the field and repeat a gentle strike.',
      overlap: 'Two strikes overlapped. Let the last note fade, then try again.',
      'insufficient-signal': 'The note was too quiet or unclear. Move a little closer and repeat.',
    };
    state.captureMessage = messages[measurement.status] ?? 'Please repeat that field.';
    state.draft.rejected++;
    await persistDraft();
    render();
    return;
  }
  const selected = state.draft.fields.find(field => field.id === state.selectedField);
  const candidates = selected ? [selected] : matchingFields(state.draft, measurement.frequency);
  if (candidates.length > 1) {
    state.pendingMeasurement = measurement;
    state.captureMessage = 'Choose the physical field you played.';
    render();
    return;
  }
  rememberUndo();
  let field = candidates[0];
  if (!field) {
    field = detectedField(measurement);
    state.draft.fields.push(field);
  }
  await recordTake(field, measurement);
}

function detectedField(measurement) {
  const note = nearestNote(measurement.frequency, state.draft.reference);
  return createField(note.midi, { side: state.draft.fields.length === 0 ? 'ding' : 'top',
    unexpected: Boolean(state.draft.instrumentId), position: '' });
}

async function recordTake(field, measurement) {
  const partials = (measurement.partials ?? []).map((partial, index) => partial?.ratio === field.ratios[index] ? partial : null);
  const report = addTake(state.draft, field.id, { ...measurement, partials });
  state.lastMeasurement = summarize(report.readings[field.id]).best;
  state.lastFieldId = field.id;
  state.pendingMeasurement = null;
  const count = report.readings[field.id].takes.length;
  state.captureMessage = `${field.label} captured. ${count < 3 ? `${3 - count} more clean ${count === 2 ? 'strike' : 'strikes'} for a repeatable check.` : 'Clear strikes saved. Play another field when ready.'}`;
  await persistDraft(report);
  document.querySelector('#announcement').textContent = `${field.label}, ${measurement.frequency.toFixed(2)} hertz. ${count} accepted strikes.`;
  render();
}

function newInstrument(fields = [], reference = state.settings.reference) {
  return { id: crypto.randomUUID(), revision: 0, createdAt: new Date().toISOString(), name: '',
    maker: '', scale: '', reference, fields: structuredClone(fields), notes: '', archived: false, baselineId: null };
}

function showDialog(content) {
  document.querySelector('#dialog-content').innerHTML = content;
  if (!dialog.open) dialog.showModal();
}

function closeDialog() { dialog.close(); state.editor = null; }

function openEditor(instrument, options = {}) {
  state.editor = { kind: 'instrument', instrument: structuredClone(instrument), ...options };
  showDialog(editorView(state.editor));
}

function editDraftField(field) {
  state.editor = { kind: 'field', instrument: newInstrument([field], state.draft.reference) };
  showDialog(editorView(state.editor));
}

function redrawEditor() {
  document.querySelector('#dialog-content').innerHTML = editorView(state.editor);
}

async function saveEditor(form) {
  try {
    const instrument = readEditor(form, state.editor);
    if (state.editor.kind === 'field') {
      rememberUndo();
      const field = instrument.fields[0];
      if (!field) throw new Error('Keep a field here, or remove it from the check instead.');
      state.draft.fields = state.draft.fields.map(item => item.id === field.id ? field : item);
      await persistDraft();
      capture.setRatios(state.draft.fields.find(field => field.id === state.selectedField)?.ratios ?? [2, 3]);
      closeDialog();
      render();
      return;
    }
    instrument.fields = resolveFields(instrument.fields, instrument.reference);
    if (state.editor.fromDraft) {
      const report = structuredClone(state.draft);
      report.instrumentId = instrument.id;
      report.instrumentName = instrument.name;
      report.reference = instrument.reference;
      report.fields = instrument.fields.map(field => ({ ...field, unexpected: false }));
      report.readings = Object.fromEntries(report.fields.filter(field => report.readings[field.id]).map(field => [field.id, report.readings[field.id]]));
      if (state.editor.finish) report.status = 'final';
      const [savedInstrument, savedReport] = await store.saveInstrumentAndReport(instrument, report);
      upsert('instruments', savedInstrument);
      upsert('reports', savedReport);
      state.draft = savedReport.status === 'draft' ? savedReport : null;
      state.dirty = false;
      const finished = state.editor.finish;
      closeDialog();
      if (finished) location.hash = `#report/${savedReport.id}`;
    } else {
      const saved = await store.save('instruments', instrument);
      upsert('instruments', saved);
      closeDialog();
      location.hash = '#library';
    }
    toast('Handpan saved.');
    render();
  } catch (error) {
    const box = document.querySelector('#editor-error');
    if (box) { box.textContent = error.message; box.hidden = false; }
    else throw error;
  }
}

async function finishReport() {
  await stopListening();
  if (!state.draft.instrumentId) {
    openEditor(newInstrument(state.draft.fields, state.draft.reference), { fromDraft: true, finish: true });
    render();
    return;
  }
  const report = await store.save('reports', { ...state.draft, status: 'final' });
  upsert('reports', report);
  state.draft = null;
  state.dirty = false;
  state.undo = [];
  location.hash = `#report/${report.id}`;
  toast('Report saved.');
}

function download(filename, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function exportBackup() {
  const reports = state.draft && state.dirty
    ? [...state.reports.filter(report => report.id !== state.draft.id), state.draft] : state.reports;
  download(`handpan-backup-${new Date().toISOString().slice(0, 10)}.json`, createBackup(state.instruments, reports));
  toast('Backup exported.');
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try { state.devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput'); }
  catch { state.devices = []; }
}

async function storageStatus() {
  if (!navigator.storage?.estimate) return;
  const [estimate, persistent] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.()]);
  state.storageStatus = `${persistent ? 'Persistent storage granted.' : 'Browser-managed storage.'} ${((estimate.usage ?? 0) / 1024 / 1024).toFixed(1)} MB used. Keep an exported backup.`;
  const element = document.querySelector('#storage-status');
  if (element) element.textContent = state.storageStatus;
}

async function install() {
  if (installPrompt) {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
  } else {
    showDialog('<div class="dialog-header"><h2 id="dialog-title">Keep your tuner close</h2><button class="text-button" data-action="close-dialog" aria-label="Close">✕</button></div><p>On iPhone or iPad, open this page in Safari, choose Share, then Add to Home Screen.</p><p>On Android or desktop, use the browser menu’s Install app or Add to Home Screen option. An already installed app can be opened from your home screen or app launcher.</p><p class="muted small">Visit once online to prepare the app for offline use.</p><div class="dialog-actions"><button class="primary" data-action="close-dialog">Got it</button></div>');
  }
}

function confirmAction(title, description, action, id, label = 'Delete') {
  showDialog(`<div class="dialog-header"><h2 id="dialog-title">${h(title)}</h2><button class="text-button" data-action="close-dialog" aria-label="Close">✕</button></div><p>${h(description)}</p><div class="dialog-actions"><button class="secondary" data-action="close-dialog">Cancel</button><button class="primary" data-action="${action}" data-id="${h(id)}">${h(label)}</button></div>`);
}

const actions = {
  discover: () => startReport(null, 'microphone'),
  practice: () => startReport(null, 'practice'),
  'new-check': () => startReport(state.instruments.find(item => item.id === state.draft?.instrumentId)),
  'new-instrument': () => openEditor(newInstrument()),
  'edit-instrument': button => openEditor(state.instruments.find(item => item.id === button.dataset.id)),
  'save-profile': async () => { await stopListening(); openEditor(newInstrument(state.draft.fields, state.draft.reference), { fromDraft: true }); render(); },
  'check-instrument': async button => {
    const instrument = state.instruments.find(item => item.id === button.dataset.id);
    const draft = state.reports.filter(report => report.instrumentId === instrument.id && report.status === 'draft').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!draft) { await startReport(instrument, 'microphone'); return; }
    showDialog(`<div class="dialog-header"><h2 id="dialog-title">Continue this check?</h2><button class="text-button" data-action="close-dialog" aria-label="Close">✕</button></div><p>${h(instrument.name)} has an unfinished check. Resume it, or save a fresh set of measurements.</p><div class="dialog-actions"><button class="secondary" data-action="start-fresh" data-id="${h(instrument.id)}">Start fresh</button><button class="primary" data-action="resume" data-id="${h(draft.id)}">Resume draft</button></div>`);
  },
  'start-fresh': async button => { closeDialog(); await startReport(state.instruments.find(item => item.id === button.dataset.id), 'microphone'); },
  resume: async button => { closeDialog(); await resumeReport(button.dataset.id); },
  'add-field': async () => {
    rememberUndo();
    const field = createField(state.lastMeasurement ? nearestNote(state.lastMeasurement.frequency, state.draft.reference).midi : 50);
    state.draft.fields.push(field);
    await persistDraft();
    editDraftField(field);
    render();
  },
  'edit-field': button => editDraftField(state.draft.fields.find(item => item.id === button.dataset.id)),
  'select-field': button => {
    state.selectedField = button.dataset.id;
    capture.setRatios(state.draft.fields.find(item => item.id === state.selectedField)?.ratios ?? [2, 3]);
    render();
    document.querySelector('#field-select').focus();
  },
  'clear-field': async button => {
    rememberUndo();
    delete state.draft.readings[button.dataset.id];
    state.lastMeasurement = null;
    await persistDraft();
    render();
  },
  'remove-field': async button => {
    const field = state.draft.fields.find(field => field.id === button.dataset.id);
    if (state.draft.instrumentId && !field.unexpected) throw new Error('This is an expected field in the saved profile. Leave it unplayed to preserve check coverage, or edit the profile for future checks.');
    rememberUndo();
    state.draft.fields = state.draft.fields.filter(field => field.id !== button.dataset.id);
    delete state.draft.readings[button.dataset.id];
    if (state.selectedField === button.dataset.id) state.selectedField = '';
    state.lastMeasurement = null;
    await persistDraft();
    render();
  },
  undo: async () => {
    if (!state.undo.length) return;
    const previous = state.undo.pop();
    previous.revision = state.draft.revision;
    state.lastMeasurement = null;
    state.pendingMeasurement = null;
    await persistDraft(previous);
    render();
  },
  assign: async button => { rememberUndo(); await recordTake(state.draft.fields.find(field => field.id === button.dataset.id), state.pendingMeasurement); },
  'assign-new': async () => {
    rememberUndo();
    const field = detectedField(state.pendingMeasurement);
    state.draft.fields.push(field);
    await recordTake(field, state.pendingMeasurement);
  },
  'duplicate-field': async () => {
    rememberUndo();
    const field = detectedField(state.lastMeasurement);
    state.draft.fields.push(field);
    await recordTake(field, state.lastMeasurement);
    state.selectedField = field.id;
    render();
  },
  'dismiss-pending': () => { state.pendingMeasurement = null; render(); },
  attach: async button => {
    await stopListening();
    rememberUndo();
    await persistDraft(attachInstrument(state.draft, state.instruments.find(item => item.id === button.dataset.id)));
    state.selectedField = '';
    state.lastMeasurement = null;
    render();
    toast('Instrument confirmed. Continue the check when ready.');
  },
  finish: finishReport,
  'retry-save': async () => { await persistDraft(); render(); toast('Check saved.'); },
  'close-dialog': closeDialog,
  'editor-add': () => {
    state.editor.instrument = readEditor(document.querySelector('#editor-form'), state.editor, false);
    state.editor.instrument.fields.push(createField(50));
    redrawEditor();
  },
  'editor-preset': () => {
    state.editor.instrument = readEditor(document.querySelector('#editor-form'), state.editor, false);
    const existing = new Set(state.editor.instrument.fields.map(field => field.midi));
    state.editor.instrument.fields.push(...presetFields().filter(field => !existing.has(field.midi)));
    redrawEditor();
  },
  'editor-remove': button => {
    state.editor.instrument = readEditor(document.querySelector('#editor-form'), state.editor, false);
    state.editor.instrument.fields = state.editor.instrument.fields.filter(field => field.id !== button.dataset.id);
    redrawEditor();
  },
  'archive-instrument': async button => {
    const instrument = readEditor(document.querySelector('#editor-form'), state.editor);
    instrument.archived = !instrument.archived;
    upsert('instruments', await store.save('instruments', instrument));
    closeDialog();
    render();
    toast(instrument.archived ? 'Handpan archived. Reports are available in history.' : 'Handpan restored to the collection.');
  },
  'delete-instrument': button => confirmAction('Delete this handpan?', 'Its profile and all its reports will be removed from this device. Export a backup first if you want to keep them.', 'confirm-delete-instrument', button.dataset.id),
  'confirm-delete-instrument': async button => {
    const instrument = state.instruments.find(item => item.id === button.dataset.id);
    await store.remove('instruments', instrument.id, instrument.revision);
    if (state.draft?.instrumentId === instrument.id) { await stopListening(); state.draft = null; }
    await load(); closeDialog(); location.hash = '#library'; render(); toast('Handpan deleted.');
  },
  'delete-report': button => confirmAction('Delete this report?', 'This measurement history will be removed from this device.', 'confirm-delete-report', button.dataset.id),
  'confirm-delete-report': async button => {
    const report = state.reports.find(item => item.id === button.dataset.id);
    await store.remove('reports', report.id, report.revision);
    if (state.draft?.id === report.id) state.draft = null;
    await load(); closeDialog(); location.hash = '#history'; render(); toast('Report deleted.');
  },
  baseline: async button => {
    const report = state.reports.find(item => item.id === button.dataset.id);
    const instrument = state.instruments.find(item => item.id === report.instrumentId);
    upsert('instruments', await store.save('instruments', { ...instrument, baselineId: report.id }));
    render(); toast('Baseline selected. You can choose it in future report comparisons.');
  },
  print: () => { document.querySelectorAll('.partial-details').forEach(details => { details.open = true; }); window.print(); },
  'share-report': async button => {
    const report = state.reports.find(item => item.id === button.dataset.id);
    const earlier = state.reports.filter(item => report.instrumentId && item.instrumentId === report.instrumentId
      && item.status === 'final' && item.createdAt < report.createdAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const previous = earlier.find(item => item.id === state.compareId) ?? earlier[0];
    const text = textReport(report, previous);
    if (navigator.share) {
      try { await navigator.share({ title: `${report.instrumentName} tuning report`, text }); }
      catch (error) { if (error.name !== 'AbortError') download('handpan-report.txt', text, 'text/plain'); }
    } else download('handpan-report.txt', text, 'text/plain');
  },
  export: exportBackup,
  persist: async () => {
    if (!navigator.storage?.persist) { toast('Persistent storage requests are unavailable in this browser. Keep a backup.'); return; }
    const persistent = await navigator.storage.persist();
    await storageStatus();
    toast(persistent ? 'Persistent storage granted.' : 'Storage remains browser-managed. Keep an exported backup.');
  },
  install,
  'check-update': async () => { await registration?.update(); toast(registration ? 'Update check complete. New versions appear here when ready.' : 'Offline support is unavailable on this origin.'); },
  update: async () => {
    await stopListening();
    if (state.dirty) await persistDraft();
    if (registration?.waiting) { applyingUpdate = true; registration.waiting.postMessage({ type: 'SKIP_WAITING' }); }
    else location.reload();
  },
  'dismiss-error': () => { document.querySelector('#error').hidden = true; },
  'reload-saved': async () => {
    if (!store) { location.reload(); return; }
    if (state.dirty) exportBackup();
    await stopListening(); state.draft = null; state.dirty = false;
    await load(); document.querySelector('#error').hidden = true; render();
  },
  play: button => capture.play(noteFrequency(Number(button.dataset.midi), state.draft.reference), state.audible),
};

document.addEventListener('click', event => {
  if (event.target.closest('.skip-link')) { event.preventDefault(); main.focus(); return; }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'toggle-listen') { toggleListening().catch(showError); return; }
  if (actions[action]) enqueue(() => actions[action](button));
});

document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'editor-form') { enqueue(() => saveEditor(form)); return; }
  if (form.id === 'settings-form') enqueue(async () => {
    const settings = { ...state.settings, id: 'preferences',
      reference: Number(form.querySelector('#reference').value), tolerance: Number(form.querySelector('#tolerance').value),
      margin: Number(form.querySelector('#margin').value), theme: form.querySelector('#theme').value };
    state.settings = await store.save('settings', settings);
    render(); toast('Settings saved. New checks will use these values.');
  });
  if (form.id === 'report-notes-form') enqueue(async () => {
    const report = state.reports.find(item => item.id === currentRoute().id);
    const saved = await store.save('reports', { ...report, notes: form.querySelector('#report-notes').value,
      service: form.querySelector('#report-service').checked });
    upsert('reports', saved);
    if (state.draft?.id === saved.id) state.draft = saved;
    render(); toast('Report notes saved.');
  });
});

document.addEventListener('change', event => {
  const input = event.target;
  const id = input.id;
  if (id === 'source-kind') { state.sourceKind = input.value; render(); }
  if (id === 'device') state.deviceId = input.value;
  if (id === 'audible') state.audible = input.checked;
  if (id === 'field-select') {
    state.selectedField = input.value;
    capture.setRatios(state.draft.fields.find(field => field.id === input.value)?.ratios ?? [2, 3]);
  }
  if (id === 'show-archived') { state.showArchived = input.checked; render(); }
  if (id === 'history-instrument') location.hash = input.value ? `#history/${input.value}` : '#history';
  if (id === 'trend-field') { state.trendField = input.value; render(); }
  if (id === 'compare-report') { state.compareId = input.value; render(); }
  if (id === 'session-service') enqueue(async () => { state.draft.service = input.checked; await persistDraft(); });
  if (input.classList.contains('field-mode')) {
    const hz = input.closest('[data-editor-field]').querySelector('.field-hz');
    hz.disabled = input.value !== 'hz';
    hz.required = input.value === 'hz';
  }
  if (id === 'import-file' && input.files[0]) {
    const file = input.files[0];
    enqueue(async () => {
      if (file.size > 50 * 1024 * 1024) throw new Error('Choose a JSON backup smaller than 50 MB.');
      if (state.dirty) await persistDraft();
      const result = await store.importBackup(await file.text());
      await load(); render();
      toast(`Restored ${result.instruments} handpans and ${result.reports} reports. ${result.existing} existing records retained.`);
    });
  }
});

document.addEventListener('input', event => {
  if (event.target.id !== 'session-notes') return;
  const id = state.draft.id;
  state.draft.notes = event.target.value;
  state.dirty = true;
  upsert('reports', state.draft);
  const saveState = document.querySelector('#save-state');
  if (saveState) saveState.textContent = 'Saving notes…';
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => enqueue(async () => {
    if (state.draft?.id !== id) return;
    await persistDraft();
  }), 400);
});

window.addEventListener('hashchange', () => enqueue(async () => {
  const route = currentRoute();
  if (route.page === 'resume') { await resumeReport(route.id); return; }
  if (route.page !== 'listen' && (state.listening || state.starting)) await stopListening();
  const newKey = `${route.page}/${route.id}`;
  render();
  if (routeKey !== newKey) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); routeKey = newKey; }
}));

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state.listening || state.starting)) {
    state.captureMessage = 'Listening paused while the app was in the background. Tap Start listening to continue.';
    stopListening().then(render);
  }
});
window.addEventListener('pagehide', () => capture.stop());
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('online', () => { document.querySelector('#offline-state').textContent = 'On-device analysis'; });
window.addEventListener('offline', () => { document.querySelector('#offline-state').textContent = 'Working offline'; });
navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

async function setupOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    state.cacheStatus = 'Offline installation needs HTTPS or localhost.';
    return;
  }
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    registration = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname });
    const updateReady = () => { document.querySelector('#update-banner').hidden = !hadController || !registration.waiting; };
    updateReady();
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') {
          state.cacheStatus = 'Ready for offline use. Instruments and reports are saved on this device.';
          updateReady();
          const status = document.querySelector('#cache-status');
          if (status) status.textContent = state.cacheStatus;
        }
      });
    });
    await navigator.serviceWorker.ready;
    state.cacheStatus = 'Ready for offline use. Instruments and reports are saved on this device.';
    const status = document.querySelector('#cache-status');
    if (status) status.textContent = state.cacheStatus;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applyingUpdate && registration.active && !reloading) {
        reloading = true; location.reload();
      }
    });
  } catch {
    state.cacheStatus = 'Offline caching could not finish. Reopen online and try again.';
    const status = document.querySelector('#cache-status');
    if (status) status.textContent = state.cacheStatus;
  }
}

try {
  store = await openStore();
  await load();
  await refreshDevices();
  if (currentRoute().page === 'resume') await resumeReport(currentRoute().id);
  else render();
  setupOffline();
  storageStatus().catch(() => {});
} catch (error) {
  main.innerHTML = `<section class="card"><h1>Your device storage could not open.</h1><p>Try a normal browser tab with site storage enabled, then reload. ${h(error.message)}</p><button class="primary" data-action="reload-saved">Try again</button></section>`;
  document.documentElement.dataset.appReady = 'failed';
}
