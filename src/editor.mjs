import { createField, noteFrequency, noteName, parseNote } from './model.mjs';
import { h } from './views.mjs';

export function fieldEditor(field, index) {
  return `<section class="editor-field" data-editor-field="${h(field.id)}"><div class="field-head"><strong>${h(field.label || 'Tone field')}</strong><button type="button" class="text-button danger compact" data-action="editor-remove" data-id="${h(field.id)}">Remove field</button></div>
    <div class="form-grid">
      <label>Note &amp; octave<input class="field-midi" data-index="${index}" value="${h(noteName(field.midi))}" placeholder="D3" required maxlength="5"></label>
      <label>Label<input class="field-label" value="${h(field.label)}" maxlength="100" placeholder="Ding"></label>
      <label>Side<select class="field-side">${[['ding', 'Ding'], ['top', 'Top'], ['bottom', 'Underside']].map(([value, label]) => `<option value="${value}" ${field.side === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label>Position<input class="field-position" value="${h(field.position)}" maxlength="100" placeholder="Front left"></label>
      <label>Target<select class="field-mode" data-index="${index}"><option value="unknown" ${field.targetMode === 'unknown' ? 'selected' : ''}>Unknown</option><option value="note" ${field.targetMode === 'note' ? 'selected' : ''}>Named note at A4</option><option value="hz" ${field.targetMode === 'hz' ? 'selected' : ''}>Custom Hz</option></select></label>
      <label>Target Hz<input class="field-hz" type="number" min="10" max="20000" step="0.00001" value="${field.targetHz ?? ''}" ${field.targetMode === 'hz' ? 'required' : 'disabled'}></label>
      <label>Octave ratio<input class="field-ratio-0" type="number" min="1.01" max="10" step="0.00001" value="${field.ratios[0] ?? ''}" placeholder="Not applicable"></label>
      <label>Twelfth ratio<input class="field-ratio-1" type="number" min="1.01" max="10" step="0.00001" value="${field.ratios[1] ?? ''}" placeholder="Not applicable"></label>
    </div></section>`;
}

export function editorView(editor) {
  const instrument = editor.instrument;
  return `<div class="dialog-header"><h2 id="dialog-title">${editor.kind === 'field' ? 'Edit tone field' : editor.fromDraft ? 'Save your handpan' : instrument.revision ? 'Edit handpan' : 'Add a handpan'}</h2><button class="text-button" data-action="close-dialog" aria-label="Close dialog">✕</button></div>
    <form id="editor-form"><div id="editor-error" class="notice error" role="alert" hidden></div>
    ${editor.kind !== 'field' ? `<div class="form-grid"><label>Handpan name<input id="instrument-name" value="${h(instrument.name)}" required maxlength="100" placeholder="My D Kurd"></label><label>Maker / model<input id="instrument-maker" value="${h(instrument.maker)}" maxlength="100" placeholder="Optional"></label><label>Scale name<input id="instrument-scale" value="${h(instrument.scale)}" maxlength="100" placeholder="Optional"></label><label>A4 reference (Hz)<input id="instrument-reference" type="number" min="300" max="600" step="0.01" value="${instrument.reference}" required></label></div>
    <label>Instrument notes<textarea id="instrument-notes" maxlength="2000">${h(instrument.notes)}</textarea></label>
    <div class="section-top section"><div><h3>Tone fields</h3><p>Confirm targets with the maker’s specification when possible.</p></div><button type="button" class="text-button" data-action="editor-preset">Add D Kurd notes</button></div>` : '<p class="muted small">Changes apply to this check’s field. Saved reports preserve their original definitions.</p>'}
    <div class="editor-fields">${instrument.fields.map(fieldEditor).join('')}</div>
    ${editor.kind !== 'field' ? '<button type="button" class="secondary" data-action="editor-add">+ Add tone field</button>' : ''}
    <div class="dialog-actions">${instrument.revision && editor.kind !== 'field' ? `<button type="button" class="text-button danger" data-action="delete-instrument" data-id="${h(instrument.id)}">Delete</button><button type="button" class="secondary" data-action="archive-instrument" data-id="${h(instrument.id)}">${instrument.archived ? 'Unarchive' : 'Archive'}</button>` : ''}<button type="button" class="secondary" data-action="close-dialog">Cancel</button><button class="primary" type="submit">${editor.kind === 'field' ? 'Save field' : editor.finish ? 'Save handpan & report' : 'Save handpan'}</button></div></form>`;
}

export function readEditor(form, editor, validate = true) {
  const instrument = structuredClone(editor.instrument);
  if (editor.kind !== 'field') {
    instrument.name = form.querySelector('#instrument-name').value.trim();
    instrument.maker = form.querySelector('#instrument-maker').value.trim();
    instrument.scale = form.querySelector('#instrument-scale').value.trim();
    instrument.reference = Number(form.querySelector('#instrument-reference').value);
    instrument.notes = form.querySelector('#instrument-notes').value;
  }
  instrument.fields = [...form.querySelectorAll('[data-editor-field]')].map(section => {
    const old = instrument.fields.find(field => field.id === section.dataset.editorField);
    const midi = parseNote(section.querySelector('.field-midi').value);
    if (validate && (midi === null || midi < 0 || midi > 127)) throw new Error('Use a note and octave such as D3, Bb3 or C#4.');
    const targetMode = section.querySelector('.field-mode').value;
    const hzText = section.querySelector('.field-hz').value;
    const ratios = [0, 1].map(index => {
      const value = section.querySelector(`.field-ratio-${index}`).value;
      return value === '' ? null : Number(value);
    });
    return { ...old, midi: midi ?? old.midi, label: section.querySelector('.field-label').value.trim() || noteName(midi ?? old.midi),
      side: section.querySelector('.field-side').value,
      position: section.querySelector('.field-position').value.trim(), targetMode,
      targetHz: targetMode === 'note' ? noteFrequency(midi ?? old.midi, instrument.reference)
        : targetMode === 'hz' && hzText !== '' ? Number(hzText) : null,
      ratios };
  });
  if (validate && editor.kind !== 'field' && !instrument.name) throw new Error('Give this handpan a name.');
  return instrument;
}

export function presetFields() {
  return [50, 57, 58, 60, 62, 64, 65, 67, 69].map((midi, index) => createField(midi, {
    side: index === 0 ? 'ding' : 'top', targetMode: 'note', position: index === 0 ? '' : String(index),
  }));
}
