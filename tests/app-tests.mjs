import { addTake, createField, createReport, noteFrequency } from '../src/model.mjs';
import { ConflictError, createBackup, openStore } from '../src/storage.mjs';
import { analyzeHandpan, StrikeCollector } from '../src/strike-collector.mjs';
import { simulateHandpan } from './simulate-handpan.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(condition, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = condition();
    if (result) return result;
    await delay(50);
  }
  throw new Error(message);
}

function instrument() {
  return { id: crypto.randomUUID(), revision: 0, name: 'Storage test instrument',
    createdAt: new Date().toISOString(), reference: 440, fields: [createField(50, { targetMode: 'note' })],
    maker: '', scale: '', notes: '', archived: false, baselineId: null };
}

export async function runAppTests(onResult = () => {}) {
  const results = [];
  async function test(name, body) {
    let result;
    try { result = { name, passed: true, details: await body() ?? 'Passed' }; }
    catch (error) { result = { name, passed: false, details: error.message }; }
    results.push(result); onResult(result);
    return result.passed;
  }

  await test('Rendered Web Audio reaches the streaming strike collector', async () => {
    const audio = await simulateHandpan();
    const readings = [];
    const collector = new StrikeCollector(audio.sampleRate, result => readings.push(result), () => {});
    for (let index = 0; index < audio.sampleRate / 2; index += 1024) collector.push(new Float32Array(1024));
    const samples = audio.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1024) collector.push(samples.slice(index, index + 1024));
    assert(readings.some(result => result.status === 'measured' && Math.abs(result.frequency - 146.83238) < 0.1), 'No streamed fundamental');
    assert(readings.length === 1, 'A single strike produced multiple readings');
  });
  await test('Upper partials are measured independently', async () => {
    const audio = await simulateHandpan();
    const result = analyzeHandpan(audio.getChannelData(0), audio.sampleRate);
    assert(result.status === 'measured', 'Fundamental rejected');
    assert(Math.abs(result.partials[0].frequency - 293.66477) < 0.15, 'Octave peak incorrect');
    assert(Math.abs(result.partials[1].frequency - 440.49715) < 0.15, 'Twelfth peak incorrect');
  });
  await test('A missing fundamental requires another strike', async () => {
    const audio = await simulateHandpan({ partials: [
      { ratio: 2, amplitude: 0.3, decay: 0.8 }, { ratio: 3, amplitude: 0.2, decay: 0.6 },
    ] });
    const result = analyzeHandpan(audio.getChannelData(0), audio.sampleRate);
    assert(result.status === 'ambiguous', `Expected ambiguous, got ${result.status}`);
  });

  const databaseName = `handpan-tests-${crypto.randomUUID()}`;
  const storage = await openStore(databaseName);
  let profile;
  let report;
  try {
    await test('IndexedDB saves a profile and report atomically', async () => {
      const draftProfile = instrument();
      const draft = createReport(draftProfile);
      [profile, report] = await storage.saveInstrumentAndReport(draftProfile, draft);
      const loaded = await storage.load();
      assert(loaded.instruments[0].id === profile.id && loaded.reports[0].instrumentId === profile.id, 'Linked records missing');
    });
    await test('A stale tab cannot overwrite a newer record', async () => {
      const old = structuredClone(profile);
      profile = await storage.save('instruments', { ...profile, name: 'Updated' });
      let rejected = false;
      try { await storage.save('instruments', old); } catch (error) { rejected = error instanceof ConflictError; }
      assert(rejected, 'Stale write was accepted');
      assert((await storage.all('instruments'))[0].name === 'Updated', 'Newer record changed');
    });
    await test('Repeated imports retain IDs and do not duplicate history', async () => {
      const snapshot = await storage.load();
      const backup = createBackup(snapshot.instruments, snapshot.reports);
      const imported = await storage.importBackup(backup);
      assert(imported.existing === 2 && imported.reports === 0 && imported.instruments === 0, 'Repeated import duplicated records');
    });
    await test('Invalid import leaves all stored records intact', async () => {
      const before = await storage.load();
      let rejected = false;
      try { await storage.importBackup(createBackup([instrument()], [{ ...report, reference: -1 }])); }
      catch { rejected = true; }
      const after = await storage.load();
      assert(rejected && after.instruments.length === before.instruments.length && after.reports.length === before.reports.length, 'Invalid import partially wrote records');
    });
    await test('Deleting a handpan removes its reports and prevents orphan saves', async () => {
      await storage.remove('instruments', profile.id, profile.revision);
      const after = await storage.load();
      assert(!after.instruments.length && !after.reports.length, 'Linked reports remain');
      let rejected = false;
      try { await storage.save('reports', { ...report, revision: 0 }); } catch { rejected = true; }
      assert(rejected, 'An orphan report was saved');
    });
  } finally {
    storage.db.close();
    indexedDB.deleteDatabase(databaseName);
  }

  // UI checks use uniquely named disposable records, with cleanup scoped to IDs
  // created during this run. Existing user records are never reset.
  const frame = document.createElement('iframe');
  frame.title = 'App integration test';
  frame.style.cssText = 'width:390px;height:844px;max-width:100%;border:1px solid #ccc;margin-top:1rem';
  frame.src = '../index.html#listen';
  document.body.append(frame);
  const appStore = await openStore();
  const original = await appStore.load();
  const originalReports = new Set(original.reports.map(report => report.id));
  const originalInstruments = new Set(original.instruments.map(item => item.id));
  const createdReports = new Set();
  let appProfile;
  let firstReport;
  const appName = `Integration ${crypto.randomUUID().slice(0, 8)}`;
  const doc = () => frame.contentDocument;
  const click = selector => {
    const button = doc().querySelector(selector);
    assert(button && !button.disabled, `Control unavailable ${selector}`);
    button.click();
  };
  const fill = (selector, value) => {
    const input = doc().querySelector(selector);
    assert(input, `Input unavailable ${selector}`);
    input.value = value;
    input.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
    input.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
  };
  try {
    const loaded = await test('Phone interface loads without horizontal overflow', async () => {
      await waitFor(() => doc()?.documentElement.dataset.appReady === 'true', 'App did not open');
      assert(doc().documentElement.scrollWidth <= 392, 'App overflows a phone viewport');
      assert(doc().querySelector('h1')?.textContent.includes('sound'), 'Welcome view missing');
    });
    if (!loaded) return results;
    const captured = await test('Practice audio runs through AudioWorklet and saves a discovered field', async () => {
      click('[data-action="practice"]');
      await waitFor(() => doc().querySelector('[data-action="toggle-listen"]'), 'Discovery did not start');
      createdReports.add(doc().querySelector('[data-report-id]').dataset.reportId);
      click('[data-action="toggle-listen"]');
      await waitFor(() => doc().querySelector('[data-action="toggle-listen"]')?.textContent.includes('Stop'), 'Audio did not start');
      await delay(600);
      click('[data-action="play"][data-midi="50"]');
      await waitFor(() => doc().querySelector('.field-row'), 'No field captured from practice audio');
      assert(doc().querySelector('.field-row').textContent.includes('D3'), 'Wrong discovered note');
      click('[data-action="toggle-listen"]');
      await waitFor(() => doc().querySelector('[data-action="toggle-listen"]')?.textContent.includes('Start'), 'Audio did not stop');
    });
    if (!captured) return results;
    const saved = await test('Discovered notes become a named handpan and dated report', async () => {
      click('[data-action="finish"]');
      await waitFor(() => doc().querySelector('#editor-form'), 'Profile editor did not open');
      fill('#instrument-name', appName);
      fill('.field-mode', 'note');
      doc().querySelector('#editor-form').requestSubmit();
      await waitFor(() => doc().querySelector('.report-measurements'), 'Report did not open');
      const loaded = await appStore.load();
      appProfile = loaded.instruments.find(item => item.name === appName);
      firstReport = loaded.reports.find(report => report.instrumentId === appProfile?.id);
      assert(appProfile && firstReport?.status === 'final', 'Linked final report missing');
      assert(firstReport.input.kind === 'practice', 'Practice source was not preserved');
      assert(firstReport.fields[0].targetHz > 146, 'Confirmed target was not saved');
    });
    if (!saved) return results;
    await test('Reload preserves reports, notes and baseline selection', async () => {
      click(`[data-action="baseline"]`);
      await waitFor(() => doc().querySelector('.report-header').textContent.includes('Baseline'), 'Baseline not selected');
      fill('#report-notes', '<script>plain text</script>');
      doc().querySelector('#report-notes-form').requestSubmit();
      await delay(200);
      await new Promise(resolve => {
        frame.addEventListener('load', resolve, { once: true });
        frame.contentWindow.location.reload();
      });
      await waitFor(() => doc()?.documentElement.dataset.appReady === 'true' && doc().querySelector('.report-measurements'), 'Report did not reopen');
      assert(doc().querySelector('#report-notes').value === '<script>plain text</script>', 'Notes did not survive reload');
      assert(!doc().querySelector('script:not([src])'), 'User text became executable markup');
    });
    await test('A second report exposes per-field comparisons and a history trend', async () => {
      let report = createReport(appProfile);
      report.createdAt = new Date(Date.now() + 1000).toISOString();
      report.input = firstReport.input;
      const field = report.fields[0];
      for (let index = 0; index < 3; index++) report = addTake(report, field.id, {
        status: 'measured', frequency: noteFrequency(field.midi) * 2 ** (-8 / 1200),
        periodicity: 0.999, spreadCents: 0.1, rms: 0.15, acceptedFrames: 10, snrDb: 40, partials: [],
      });
      report.status = 'final';
      const saved = await appStore.save('reports', report);
      frame.src = `../index.html?integration=${crypto.randomUUID()}#report/${saved.id}`;
      await waitFor(() => doc()?.querySelector('#compare-report'), 'Comparison picker missing');
      assert(doc().querySelector('tbody').textContent.includes('drift'), 'Per-field drift missing');
      frame.contentWindow.location.hash = `#history/${appProfile.id}`;
      await waitFor(() => doc().querySelector('.trend svg'), 'History trend missing');
      assert(doc().querySelectorAll('.trend-point').length === 2, 'Trend omitted a measured report');
    });
    await test('Microphone start and stop use the real capture entry point', async () => {
      frame.src = `../index.html?integration=${crypto.randomUUID()}#library`;
      await waitFor(() => doc()?.querySelector(`[data-action="check-instrument"][data-id="${appProfile.id}"]`), 'Handpan missing from collection');
      click(`[data-action="check-instrument"][data-id="${appProfile.id}"]`);
      await waitFor(() => doc().querySelector('[data-action="toggle-listen"]'), 'New check did not open');
      click('[data-action="toggle-listen"]');
      await waitFor(() => doc().querySelector('[data-action="toggle-listen"]')?.textContent.includes('Stop'), 'Microphone did not start');
      click('[data-action="toggle-listen"]');
      await waitFor(() => doc().querySelector('[data-action="toggle-listen"]')?.textContent.includes('Start'), 'Microphone did not stop');
    });
    await test('Microphone denial has a recoverable message', async () => {
      const devices = frame.contentWindow.navigator.mediaDevices;
      const original = devices.getUserMedia;
      devices.getUserMedia = () => Promise.reject(new frame.contentWindow.DOMException('Denied', 'NotAllowedError'));
      click('[data-action="toggle-listen"]');
      await waitFor(() => !doc().querySelector('#error').hidden, 'Permission denial was not shown');
      assert(doc().querySelector('#error').textContent.includes('site settings'), 'Recovery instruction missing');
      assert(doc().querySelector('[data-action="toggle-listen"]').textContent.includes('Start'), 'Start did not recover');
      devices.getUserMedia = original;
    });
    await test('Offline cache contains the entire audio pipeline', async () => {
      await frame.contentWindow.navigator.serviceWorker.ready;
      const keys = await caches.keys();
      const cache = await caches.open(keys.find(key => key.startsWith('free-handpan-')));
      for (const path of ['../index.html', '../src/capture-worklet.mjs', '../src/analysis-worker.mjs', '../src/strike-collector.mjs', '../icons/icon-192.png']) {
        assert(await cache.match(new URL(path, location.href)), `Offline asset missing ${path}`);
      }
    });
  } finally {
    frame.remove();
    const current = await appStore.load();
    // Unique IDs limit cleanup to the records this UI flow created.
    for (const item of current.instruments.filter(item => !originalInstruments.has(item.id) && item.name === appName)) {
      await appStore.remove('instruments', item.id, item.revision);
    }
    const remaining = await appStore.all('reports');
    for (const report of remaining.filter(report => createdReports.has(report.id) && !originalReports.has(report.id))) {
      await appStore.remove('reports', report.id, report.revision);
    }
    appStore.db.close();
  }
  return results;
}
