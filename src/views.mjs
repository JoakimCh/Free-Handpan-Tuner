import { assessField, compareField, nearestNote, noteName, noteFrequency, reportSummary,
  summarize, recognitionMatches, serviceCandidates } from './model.mjs';
import { centsBetween } from './analyze-strike.mjs';

export function h(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function dateTime(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function cents(value) { return `${value > 0 ? '+' : ''}${value.toFixed(1)}¢`; }
export function hz(value) { return `${value.toFixed(2)} Hz`; }
const sideName = { ding: 'Ding', top: 'Top', bottom: 'Underside' };

function pageTitle(eyebrow, title, action = '') {
  return `<header class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div>${action}</header>`;
}

function empty(title, message, action = '') {
  return `<div class="empty"><div class="empty-mark" aria-hidden="true">◎</div><h2>${title}</h2><p>${message}</p>${action}</div>`;
}

function noteChips(fields) {
  return `<div class="note-chips">${fields.map(field => `<span>${h(field.label)}</span>`).join('')}</div>`;
}

function fieldRows(report, selectedField, editable = true) {
  if (!report.fields.length) return `<div class="quiet-empty"><p>Each clear strike will appear here.</p><p class="muted">Start with the ding, then work around the top. Include any underside notes.</p></div>`;
  return report.fields.map(field => {
    const assessment = assessField(report, field);
    const value = assessment.value;
    const best = value?.best;
    const bestError = best && field.targetHz ? centsBetween(best.frequency, field.targetHz) : null;
    const status = { unplayed: 'Unplayed', 'unknown-target': 'Target unknown', within: 'Within tolerance', outside: 'Outside tolerance' }[assessment.status];
    return `<article class="field-row ${assessment.status} ${selectedField === field.id ? 'selected' : ''}" data-field="${h(field.id)}">
      <div class="field-note"><span class="field-dot" aria-hidden="true"></span><strong>${h(field.label)}</strong><span class="muted">${h(sideName[field.side])}${field.position ? ` · ${h(field.position)}` : ''}${field.unexpected ? ' · Unexpected' : ''}</span></div>
      <div class="field-reading"><strong>${bestError == null ? best ? hz(best.frequency) : '—' : cents(bestError)}</strong><span>${h(status)}${value ? ` · ${value.count} ${value.count === 1 ? 'strike' : 'strikes'}` : ''}</span></div>
      ${editable ? `<details class="field-options"><summary aria-label="Options for ${h(field.label)}">•••</summary><div>
        <button data-action="select-field" data-id="${h(field.id)}">Listen to this field</button>
        <button data-action="edit-field" data-id="${h(field.id)}">Edit field &amp; target</button>
        <button data-action="clear-field" data-id="${h(field.id)}" ${value ? '' : 'disabled'}>Retry from scratch</button>
        ${!report.instrumentId || field.unexpected ? `<button data-action="remove-field" data-id="${h(field.id)}">Remove from this check</button>` : ''}
      </div></details>` : ''}
    </article>`;
  }).join('');
}

export function listenView(state) {
  const report = state.draft;
  if (!report) return `${pageTitle('LISTEN & DISCOVER', 'A little closer to your sound.')}
    <section class="welcome card"><div class="handpan-art" aria-hidden="true"><i></i><b></b><em></em></div><div><p class="eyebrow">YOUR HANDPAN, HEARD CLEARLY</p><h2>Every note has<br>a story to tell.</h2><p>Discover an unfamiliar handpan or check how your own instrument has changed. Play one field at a time. We’ll keep the clearest strikes.</p>
    <div class="actions"><button class="primary" data-action="discover">Discover a handpan <span aria-hidden="true">↗</span></button><a class="button secondary" href="#library">Check a saved handpan</a></div>
    <button class="text-button" data-action="practice">Try with practice audio <span aria-hidden="true">→</span></button></div></section>
    ${state.reports.some(report => report.status === 'draft') ? `<section class="section"><h2>Pick up where you left off</h2>${reportCards(state.reports.filter(report => report.status === 'draft'), true)}</section>` : ''}
    <div class="intro-grid"><article><span aria-hidden="true">◌</span><h3>Find every tone</h3><p>Discover the ding, top fields and underside notes. Save the layout that makes your handpan yours.</p></article><article><span aria-hidden="true">↗</span><h3>Follow the changes</h3><p>Keep dated checks and compare each physical field over time.</p></article><article><span aria-hidden="true">◎</span><h3>Keep it with you</h3><p>Works offline after your first visit. Your measurements stay on your device.</p></article></div>`;

  const summary = reportSummary(report);
  const last = state.lastMeasurement;
  const named = last ? nearestNote(last.frequency, report.reference) : null;
  const active = report.fields.find(field => field.id === state.lastFieldId);
  const error = last ? centsBetween(last.frequency, active?.targetHz ?? noteFrequency(named.midi, report.reference)) : null;
  const matches = !report.instrumentId ? recognitionMatches(report, state.instruments).slice(0, 4) : [];
  return `${pageTitle(report.instrumentId ? 'CHECK YOUR HANDPAN' : 'DISCOVER YOUR HANDPAN', h(report.instrumentName), `<button class="secondary compact" data-action="new-check">New check</button>`)}
    <div class="session-meta"><span>${report.input?.kind === 'practice' || state.sourceKind === 'practice' ? 'Practice audio' : 'Microphone'} · A4 = ${report.reference} Hz</span><span id="save-state">${state.dirty ? 'Unsaved changes' : 'Draft saved on this device'}</span></div>
    ${state.dirty ? `<div class="notice error">This check has unsaved changes. <button data-action="retry-save">Retry save</button> <button data-action="export">Back up now</button></div>` : ''}
    <div class="listen-layout" data-report-id="${h(report.id)}"><section class="tuner card" aria-label="Live tuner">
      <div class="listening-state"><span class="status-dot ${state.listening ? 'pulse' : ''}"></span><span id="live-state">${state.listening ? 'Listening' : 'Ready when you are'}</span></div>
      <div class="live-pitch"><span id="live-note">${named ? h(named.name.replace(/-?\d+$/, '')) : '—'}</span><span id="live-octave">${named ? Math.floor(named.midi / 12) - 1 : ''}</span></div>
      <p id="live-frequency" class="live-frequency">${last ? hz(last.frequency) : 'Play one field at a time'}</p>
      <div class="gauge" role="img" aria-label="Pitch deviation from target or suggested note"><div class="tolerance-band" style="left:${50 - Math.min(50, report.tolerance)}%;width:${Math.min(100, report.tolerance * 2)}%"></div><div id="needle" class="needle" style="--cents:${Math.max(-50, Math.min(50, error ?? 0))}"></div><div class="gauge-ticks"><span>−50</span><span>−25</span><span>0</span><span>+25</span><span>+50</span></div></div>
      <p id="live-cents" class="live-cents">${error == null ? 'Waiting for a clear strike' : `${cents(error)} ${error < 0 ? 'flat' : 'sharp'}${active?.targetHz ? '' : ' · suggested note'}`}</p>
      <div class="signal"><span>INPUT</span><meter id="input-level" min="0" max="1" value="0" aria-label="Microphone input level"></meter></div>
      <p id="live-message" class="capture-message">${h(state.captureMessage || 'Let the last note fade. A gentle, clear tap works best.')}</p>
      <div class="capture-controls"><button class="primary start-button" data-action="toggle-listen" ${state.starting ? 'disabled' : ''}>${state.starting ? 'Opening audio…' : state.listening ? '■ Stop listening' : '● Start listening'}</button></div>
      <label class="small-label" for="source-kind">Audio source</label><select id="source-kind" ${state.listening || state.starting ? 'disabled' : ''}><option value="microphone" ${state.sourceKind !== 'practice' ? 'selected' : ''}>Microphone</option><option value="practice" ${state.sourceKind === 'practice' ? 'selected' : ''}>Practice audio</option></select>
      ${state.sourceKind === 'microphone' ? `<label class="small-label" for="device">Input</label><select id="device" ${state.listening || state.starting ? 'disabled' : ''}><option value="">Default microphone</option>${state.devices.map(device => `<option value="${h(device.deviceId)}" ${device.deviceId === state.deviceId ? 'selected' : ''}>${h(device.label || 'Microphone')}</option>`).join('')}</select>` : `<div class="practice-pads" aria-label="Practice handpan tones">${[50, 57, 58, 60, 62, 64, 65, 67, 69].map(midi => `<button data-action="play" data-midi="${midi}" ${state.listening ? '' : 'disabled'}>${noteName(midi)}</button>`).join('')}</div><label class="checkbox"><input id="audible" type="checkbox" ${state.audible ? 'checked' : ''}> Hear practice tones</label><p class="muted small">Tap a practice pad after listening starts. These checks are marked as practice.</p>`}
    </section><section class="capture-list card">
      <div class="section-top"><div><h2>Your tone fields</h2><p>${summary.measured} of ${summary.expected} captured${summary.outside ? ` · ${summary.outside} outside tolerance` : ''}</p></div><button class="text-button" data-action="add-field">+ Add field</button></div>
      <label class="small-label" for="field-select">Match the next strike</label><select id="field-select"><option value="">Automatically detect field</option>${report.fields.map(field => `<option value="${h(field.id)}" ${state.selectedField === field.id ? 'selected' : ''}>${h(field.label)} · ${h(sideName[field.side])}${field.position ? ` · ${h(field.position)}` : ''}</option>`).join('')}</select>
      ${state.pendingMeasurement ? `<div class="notice"><strong>Choose the physical field you played.</strong><p>This pitch matches more than one field.</p><div class="actions">${matchingPending(report, state.pendingMeasurement).map(field => `<button data-action="assign" data-id="${h(field.id)}">${h(field.label)} · ${h(sideName[field.side])} ${h(field.position)}</button>`).join('')}<button data-action="assign-new">Add a separate field</button><button data-action="dismiss-pending">Discard strike</button></div></div>` : ''}
      <div class="field-list">${fieldRows(report, state.selectedField)}</div>
      <p class="muted small">Best strike shown. Reports use the median of all accepted strikes. Repeat each field three times for comparisons.</p>
      <div class="actions"><button class="text-button" data-action="undo" ${state.undo.length ? '' : 'disabled'}>↶ Undo last change</button>${last ? '<button class="text-button" data-action="duplicate-field">Add separate field at this pitch</button>' : ''}</div>
      ${matches.length ? `<details class="recognition"><summary>Possible saved handpans</summary><p class="muted small">A shared scale can belong to several instruments. Confirm the instrument to attach this check.</p>${matches.map(match => `<div class="match"><div><strong>${h(match.instrument.name)}</strong><p>${match.matched} matching fields · ${match.total} in profile</p></div><button class="secondary compact" data-action="attach" data-id="${h(match.instrument.id)}">Use this handpan</button></div>`).join('')}</details>` : ''}
      <details class="session-notes"><summary>Check notes &amp; conditions</summary><label for="session-notes">Room, phone placement, temperature or observations</label><textarea id="session-notes" maxlength="2000">${h(report.notes)}</textarea><label class="checkbox"><input type="checkbox" id="session-service" ${report.service ? 'checked' : ''}> This check follows a service or retuning</label></details>
      <div class="session-actions">${!report.instrumentId ? '<button class="secondary" data-action="save-profile">Save handpan</button>' : ''}<button class="primary" data-action="finish" ${summary.measured ? '' : 'disabled'}>Save report <span aria-hidden="true">→</span></button></div>
    </section></div>
    <details class="help"><summary>Get a repeatable check</summary><p>Let the handpan settle at room temperature. Use a quiet room, keep the phone in a repeatable position, and play one field gently. Let the previous field fade. If a field is difficult to identify, select it manually and try again. Measurements currently cover approximately 55–1400 Hz. Upper-partial readings are experimental.</p></details>`;
}

function matchingPending(report, measurement) {
  return report.fields.filter(field => Math.abs(centsBetween(measurement.frequency, field.targetHz ?? noteFrequency(field.midi, report.reference))) <= 65);
}

export function libraryView(state) {
  const instruments = state.instruments.filter(instrument => state.showArchived || !instrument.archived);
  return `${pageTitle('YOUR COLLECTION', 'Handpans', '<button class="primary" data-action="new-instrument">+ Add handpan</button>')}
    <div class="section-toolbar"><p class="muted">A home for every instrument and its tuning history.</p><label class="checkbox"><input id="show-archived" type="checkbox" ${state.showArchived ? 'checked' : ''}> Show archived</label></div>
    ${instruments.length ? `<div class="instrument-grid">${instruments.map(instrument => {
      const reports = state.reports.filter(report => report.instrumentId === instrument.id && report.status === 'final').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return `<article class="instrument card"><div class="instrument-top"><span class="instrument-icon" aria-hidden="true">◎</span><button class="text-button" data-action="edit-instrument" data-id="${h(instrument.id)}">Edit</button></div>
        <p class="eyebrow">${h(instrument.maker || 'YOUR INSTRUMENT')}${instrument.archived ? ' · ARCHIVED' : ''}</p><h2>${h(instrument.name)}</h2><p class="muted">${h(instrument.scale || 'Custom scale')} · ${instrument.fields.length} fields · A4 ${instrument.reference} Hz</p>${noteChips(instrument.fields)}
        <div class="instrument-last"><span>${reports.length ? `Last checked ${h(dateTime(reports[0].createdAt))}` : 'Ready for its first check'}</span><span>${reports.length} ${reports.length === 1 ? 'report' : 'reports'}</span></div>
        <div class="actions"><button class="primary" data-action="check-instrument" data-id="${h(instrument.id)}">Check tuning <span aria-hidden="true">→</span></button><a class="button secondary" href="#history/${h(instrument.id)}">History</a></div>
      </article>`;
    }).join('')}</div>` : empty('Make room for your first handpan.', 'Create a profile with the notes you know, or let the microphone help you discover them.', '<button class="primary" data-action="discover">Discover its notes</button><button class="secondary" data-action="new-instrument">Add notes manually</button>')}`;
}

function reportCards(reports, drafts = false) {
  return `<div class="report-list">${[...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(report => {
    const summary = reportSummary(report);
    return `<a class="report-card card" href="${drafts || report.status === 'draft' ? `#resume/${h(report.id)}` : `#report/${h(report.id)}`}"><div><p class="eyebrow">${report.status === 'draft' ? 'DRAFT' : report.service ? 'AFTER SERVICE' : 'TUNING CHECK'}${report.input?.kind === 'practice' ? ' · PRACTICE' : ''}</p><h3>${h(report.instrumentName)}</h3><p>${h(dateTime(report.createdAt))}</p></div><div class="report-meta"><strong>${summary.measured}/${summary.expected} fields</strong><span>${summary.outside ? `${summary.outside} outside tolerance` : 'View measurements'} <span aria-hidden="true">↗</span></span></div></a>`;
  }).join('')}</div>`;
}

function trend(reports, instrument, fieldId) {
  const field = instrument.fields.find(field => field.id === fieldId) ?? instrument.fields[0];
  if (!field) return '';
  const points = [...reports].filter(report => report.status === 'final').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-20).map(report => {
    const captured = report.fields.find(candidate => candidate.id === field.id);
    const value = summarize(report.readings[field.id]);
    return { report, value, field: captured };
  });
  if (points.filter(point => point.value).length < 2) return '<p class="muted">Save two reports of this field to see its trend.</p>';
  const target = field.targetHz ?? (field.targetMode === 'note' ? noteFrequency(field.midi, instrument.reference) : null);
  const values = points.map(point => point.value ? target ? centsBetween(point.value.frequency, target) : point.value.frequency : null);
  const measured = values.filter(value => value !== null);
  const lower = target ? Math.min(-15, ...measured) - 2 : Math.min(...measured) - 0.5;
  const upper = target ? Math.max(15, ...measured) + 2 : Math.max(...measured) + 0.5;
  const y = value => 155 - (value - lower) / (upper - lower) * 130;
  const x = index => 55 + index / Math.max(1, points.length - 1) * 540;
  let path = '';
  let interrupted = true;
  values.forEach((value, index) => {
    if (value === null) { interrupted = true; return; }
    path += `${interrupted ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
    interrupted = false;
  });
  return `<figure class="trend"><figcaption>${h(field.label)} · ${target ? 'cents from current target' : 'measured Hz'} · last ${points.length} reports</figcaption><svg viewBox="0 0 640 205" role="img" aria-label="Pitch history of ${h(field.label)}">
    ${[lower, (lower + upper) / 2, upper].map(value => `<line class="grid-line" x1="55" x2="600" y1="${y(value)}" y2="${y(value)}"/><text x="3" y="${y(value) + 4}">${value.toFixed(1)}</text>`).join('')}
    ${target ? `<line class="zero-line" x1="55" x2="600" y1="${y(0)}" y2="${y(0)}"/>` : ''}<path class="trend-line" d="${path}"/>
    ${values.map((value, index) => value == null ? '' : `<circle class="trend-point" cx="${x(index)}" cy="${y(value)}" r="4"><title>${h(dateTime(points[index].report.createdAt))}: ${value.toFixed(2)} ${target ? 'cents' : 'Hz'}${points[index].report.service ? ' · after service' : ''}</title></circle>`).join('')}
    <text x="55" y="190">${h(new Date(points[0].report.createdAt).toLocaleDateString())}</text><text x="600" y="190" text-anchor="end">${h(new Date(points.at(-1).report.createdAt).toLocaleDateString())}</text></svg></figure>`;
}

export function historyView(state, instrumentId) {
  const instrument = state.instruments.find(item => item.id === instrumentId);
  const reports = state.reports.filter(report => !instrumentId || report.instrumentId === instrumentId);
  return `${pageTitle('TRACK THE CHANGES', instrument ? h(instrument.name) : 'Tuning history', instrument ? `<button class="primary" data-action="check-instrument" data-id="${h(instrument.id)}">New check</button>` : '')}
    <label class="small-label" for="history-instrument">Instrument</label><select id="history-instrument"><option value="">All handpans</option>${state.instruments.map(item => `<option value="${h(item.id)}" ${item.id === instrumentId ? 'selected' : ''}>${h(item.name)}</option>`).join('')}</select>
    ${instrument ? `<section class="card trend-card"><div class="section-top"><h2>Pitch over time</h2><select id="trend-field" aria-label="Field to plot">${instrument.fields.map(field => `<option value="${h(field.id)}" ${field.id === state.trendField ? 'selected' : ''}>${h(field.label)} · ${h(sideName[field.side])} ${h(field.position)}</option>`).join('')}</select></div>${trend(reports, instrument, state.trendField)}</section>` : ''}
    ${reports.length ? reportCards(reports) : empty('Your next check starts the story.', 'Saved checks appear here with each field’s measurements and changes over time.', instrument ? `<button class="primary" data-action="check-instrument" data-id="${h(instrument.id)}">Check this handpan</button>` : '<a class="button primary" href="#listen">Start a check</a>')}`;
}

export function reportView(state, id) {
  const report = state.reports.find(report => report.id === id);
  if (!report) return empty('Report unavailable', 'It may have been removed or imported on another device.', '<a class="button primary" href="#history">Open history</a>');
  const instrument = state.instruments.find(item => item.id === report.instrumentId);
  const earlier = state.reports.filter(item => report.instrumentId && item.instrumentId === report.instrumentId && item.id !== id && item.status === 'final' && item.createdAt <= report.createdAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const compare = state.reports.find(item => item.id === state.compareId && earlier.some(candidate => candidate.id === item.id)) ?? earlier[0];
  const summary = reportSummary(report);
  const service = serviceCandidates(report, compare);
  return `${pageTitle(report.input?.kind === 'practice' ? 'PRACTICE REPORT' : 'TUNING REPORT', h(report.instrumentName), '<button class="secondary" data-action="print">Print report</button>')}
    <div class="report-header"><p>${h(dateTime(report.createdAt))}${report.service ? ' · After service' : ''}${instrument?.baselineId === id ? ' · Baseline' : ''}</p><p>A4 ${report.reference} Hz · Tolerance ±${report.tolerance}¢ · ${h(report.input?.label || 'Input unrecorded')}</p></div>
    <div class="report-stats"><div class="card"><strong>${summary.measured}<small>/${summary.expected}</small></strong><span>fields checked</span></div><div class="card"><strong>${summary.outside}</strong><span>outside tolerance</span></div><div class="card"><strong>${report.fields.filter(field => summarize(report.readings[field.id])?.count >= 3).length}</strong><span>fields with 3+ strikes</span></div></div>
    ${service.length ? `<div class="notice">${service.map(field => h(field.label)).join(', ')} measured outside tolerance across two comparable dates. Consider sharing these reports with your maker.</div>` : ''}
    ${report.status === 'draft' ? `<div class="notice">This is an unfinished check. <button data-action="resume" data-id="${h(report.id)}">Continue listening</button></div>` : ''}
    <section class="card report-measurements"><div class="section-top"><div><h2>Field measurements</h2><p>Median of accepted strikes · best strike preserved separately</p></div></div>
    ${earlier.length ? `<div class="comparison-picker"><label for="compare-report">Compare with</label><select id="compare-report">${earlier.map(item => `<option value="${h(item.id)}" ${item.id === compare?.id ? 'selected' : ''}>${h(dateTime(item.createdAt))}${instrument?.baselineId === item.id ? ' · Baseline' : ''}</option>`).join('')}</select></div>` : '<p class="muted">Save another check of this instrument to compare changes.</p>'}
    <div class="table-scroll"><table><thead><tr><th>Field</th><th>Measured</th><th>Target / error</th><th>Strikes</th><th>Change</th></tr></thead><tbody>${report.fields.map(field => {
      const assessment = assessField(report, field);
      const value = assessment.value;
      const change = compare ? compareField(report, compare, field) : null;
      return `<tr><th scope="row">${h(field.label)}<small>${h(sideName[field.side])} ${h(field.position)}${field.unexpected ? ' · unexpected' : ''}</small></th><td>${value ? hz(value.frequency) : 'Unplayed'}${value ? `<small>Best ${hz(value.best.frequency)}</small>` : ''}</td><td>${field.targetHz ? hz(field.targetHz) : 'Unknown target'}<small class="${assessment.status}">${assessment.error == null ? 'Unassessed' : `${cents(assessment.error)} · ${assessment.status === 'within' ? 'within tolerance' : 'outside tolerance'}`}</small></td><td>${value ? `${value.count}<small>Spread ±${value.spread.toFixed(1)}¢</small>` : '—'}</td><td>${change ? `${cents(change.drift)} drift<small>${change.score == null ? '' : `${change.score > 0 ? '+' : ''}${change.score.toFixed(1)} closer score · `}${h({ better: 'Better', worse: 'Worse', similar: 'Within variation', inconclusive: change.reason }[change.verdict])}</small>` : '—'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="muted small">Change judgments need three agreeing strikes in both checks and the same input, targets and analysis version. The default comparison margin is a screening setting.</p></section>
    <details class="card partial-details"><summary>Upper partials <span class="muted">· experimental</span></summary><p>Best-strike spectral peaks near the field’s expected ratios. Unresolved peaks stay unmeasured. Upper partials do not affect the tuning verdict.</p><div class="table-scroll"><table><thead><tr><th>Field</th><th>Octave / ratio 1</th><th>Twelfth / ratio 2</th></tr></thead><tbody>${report.fields.map(field => {
      const value = summarize(report.readings[field.id]);
      return `<tr><th scope="row">${h(field.label)}</th>${[0, 1].map(index => {
        const recorded = value?.best.partials?.[index];
        const partial = recorded?.ratio === field.ratios[index] ? recorded : null;
        return `<td>${partial ? `${hz(partial.frequency)}<small>${field.targetHz && field.ratios[index] ? `${cents(centsBetween(partial.frequency, field.targetHz * field.ratios[index]))} from target` : `Measured ratio ${partial.ratio}`}</small>` : field.ratios[index] == null ? 'Not applicable' : 'Unmeasured'}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table></div></details>
    <section class="card report-notes"><h2>Notes &amp; service</h2><form id="report-notes-form"><label for="report-notes">Conditions or observations</label><textarea id="report-notes" maxlength="2000">${h(report.notes)}</textarea><label class="checkbox"><input type="checkbox" id="report-service" ${report.service ? 'checked' : ''}> This check follows a service or retuning</label><button class="secondary" type="submit">Save notes</button></form></section>
    <div class="actions report-actions">${instrument && report.status === 'final' ? `<button class="secondary" data-action="baseline" data-id="${h(report.id)}">${instrument.baselineId === id ? 'Current baseline' : 'Use as baseline'}</button><button class="primary" data-action="check-instrument" data-id="${h(instrument.id)}">Check again</button>` : ''}<button class="secondary" data-action="share-report" data-id="${h(report.id)}">Share text report</button><button class="text-button danger" data-action="delete-report" data-id="${h(report.id)}">Delete report</button></div>`;
}

export function settingsView(state) {
  return `${pageTitle('MAKE IT YOURS', 'Settings')}
    <div class="settings-grid"><section class="card"><h2>Tuning &amp; comparison</h2><form id="settings-form">
      <label for="reference">Default A4 reference (Hz)</label><input id="reference" type="number" min="300" max="600" step="0.01" value="${state.settings.reference}" required><p class="hint">For new discoveries. Each saved instrument has its own reference.</p>
      <label for="tolerance">Tuning tolerance (cents)</label><input id="tolerance" type="number" min="1" max="100" step="1" value="${state.settings.tolerance}" required>
      <label for="margin">Minimum comparison margin (cents)</label><input id="margin" type="number" min="1" max="100" step="1" value="${state.settings.margin}" required><p class="hint">Screening settings. Use your maker’s tolerance when available. Strike variation can increase the comparison margin.</p>
      <label for="theme">Appearance</label><select id="theme"><option value="system" ${state.settings.theme === 'system' ? 'selected' : ''}>Follow device</option><option value="light" ${state.settings.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${state.settings.theme === 'dark' ? 'selected' : ''}>Dark</option></select>
      <button class="primary" type="submit">Save settings</button></form></section>
    <div><section class="card"><h2>Your data</h2><p>Instruments and reports are stored on this device. Keep a backup to move them to another device or recover from cleared browser data.</p><div class="actions"><button class="primary" data-action="export">Export backup</button><label class="button secondary" for="import-file">Restore backup</label><input class="sr-only" id="import-file" type="file" accept=".json,application/json"></div><p class="hint">Versioned JSON. Restoring keeps existing records and adds missing ones.</p><p id="storage-status" class="muted small">${h(state.storageStatus || 'Checking device storage…')}</p><button class="text-button" data-action="persist">Request persistent storage</button></section>
    <section class="card"><h2>Install &amp; offline</h2><p id="cache-status">${h(state.cacheStatus || 'Preparing offline support…')}</p><div class="actions"><button class="secondary" data-action="install">Install app</button><button class="text-button" data-action="check-update">Check for updates</button></div><p class="hint">On iPhone or iPad, open in Safari, choose Share, then Add to Home Screen. On other devices, use the browser’s install option.</p></section></div></div>
    <section class="card about"><h2>About this tuner</h2><p>Free Handpan Tuner helps you identify notes and keep a history of an instrument’s tuning. Let the instrument reach room temperature and compare repeatable strikes in similar conditions.</p><p>Fundamental detection currently searches approximately 55–1400 Hz. Results can be affected by ringing neighbors, the room and your microphone. Upper-partial detection is experimental. Send repeatable unexpected measurements to your maker for assessment.</p><p>Audio is analyzed locally and discarded. No account, analytics, third-party libraries or audio uploads.</p><a href="https://github.com/JoakimCh/Free-Handpan-Tuner" target="_blank" rel="noopener">Source code &amp; project documentation ↗</a></section>`;
}

export function textReport(report, previous) {
  const lines = ['Free Handpan Tuner', report.instrumentName, dateTime(report.createdAt),
    `${report.input?.kind ?? 'Unknown input'} · A4 ${report.reference} Hz · tolerance ±${report.tolerance} cents`, ''];
  for (const field of report.fields) {
    const assessment = assessField(report, field);
    const value = assessment.value;
    const change = previous ? compareField(report, previous, field) : null;
    lines.push(`${field.label} (${sideName[field.side]} ${field.position}) ${value ? `${hz(value.frequency)}, ${value.count} strikes, ${assessment.error == null ? 'target unknown' : cents(assessment.error)}` : 'unplayed'}${change ? `, drift ${cents(change.drift)}` : ''}`);
  }
  lines.push('', report.notes, report.service ? 'Check follows service / retuning.' : '', 'Measurements are a screening aid. Upper-partial analysis is experimental.');
  return lines.join('\n');
}
