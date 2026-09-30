// Structured shape-row editor for diagramSpec — no freeform canvas dragging,
// per the user's confirmed scope decision. One row per shape, type-select to
// add rows, type-conditional numeric/text fields. Preview renders through
// renderers/chalkboard/diagram-renderer.js (mode:'static') — the same
// renderer Present mode uses, never a second SVG-building code path.
import { renderDiagram } from '../renderers/chalkboard/diagram-renderer.js';
import { RENDER_MODES } from '../renderers/renderer-interface.js';

const SHAPE_FIELDS = {
  box: [['x', 'number'], ['y', 'number'], ['w', 'number'], ['h', 'number'], ['label', 'text']],
  arrow: [['from', 'text'], ['to', 'text'], ['style', 'select:solid,dashed'], ['label', 'text']],
  line: [['x1', 'number'], ['y1', 'number'], ['x2', 'number'], ['y2', 'number'], ['style', 'select:solid,dashed,underline']],
  label: [['x', 'number'], ['y', 'number'], ['text', 'text'], ['anchor', 'select:start,middle,end']],
  'highlight-region': [['targetBlockId', 'text'], ['shape', 'select:rect,ellipse'], ['padding', 'number']],
  'custom-svg': [['raw', 'textarea']],
};

export function mountDiagramFormEditor(containerEl, controller, slideId) {
  containerEl.innerHTML = `
    <div class="diagram-form">
      <label><input type="checkbox" class="diagram-enable-toggle" /> This slide has a diagram</label>
      <div class="diagram-body" style="display:none;">
        <div class="diagram-shape-rows"></div>
        <div class="diagram-add-row">
          <select class="diagram-shape-type-select">
            <option value="box">Box</option>
            <option value="arrow">Arrow</option>
            <option value="line">Line</option>
            <option value="label">Label</option>
            <option value="highlight-region">Highlight region</option>
            <option value="custom-svg">Custom SVG</option>
          </select>
          <button class="diagram-add-btn">+ Add shape</button>
        </div>
        <svg class="diagram-preview-svg" width="100%" height="160"></svg>
      </div>
    </div>
  `;

  const toggle = containerEl.querySelector('.diagram-enable-toggle');
  const body = containerEl.querySelector('.diagram-body');
  const rowsEl = containerEl.querySelector('.diagram-shape-rows');
  const typeSelect = containerEl.querySelector('.diagram-shape-type-select');
  const addBtn = containerEl.querySelector('.diagram-add-btn');
  const previewSvg = containerEl.querySelector('.diagram-preview-svg');

  function getSlide() { return controller.getSlide(slideId); }

  toggle.addEventListener('change', () => {
    const slide = getSlide();
    if (toggle.checked && !slide.diagramSpec) {
      slide.diagramSpec = { canvas: { width: 600, height: 300 }, shapes: [], revealWithSteps: [] };
      slide.edited.diagramSpec = true;
      render();
    } else if (!toggle.checked) {
      slide.diagramSpec = null;
      slide.edited.diagramSpec = true;
      render();
    }
  });

  addBtn.addEventListener('click', () => {
    const type = typeSelect.value;
    const defaults = { box: { x: 20, y: 20, w: 160, h: 60 }, arrow: { from: '', to: '' }, line: { x1: 0, y1: 0, x2: 100, y2: 0 }, label: { x: 20, y: 20, text: 'Label' }, 'highlight-region': { targetBlockId: '', padding: 6 }, 'custom-svg': { raw: '' } };
    controller.addShape(slideId, { type, ...defaults[type] });
  });

  function renderShapeRow(shape) {
    const row = document.createElement('div');
    row.className = 'diagram-shape-row';
    const typeLabel = document.createElement('span');
    typeLabel.className = 'diagram-shape-type-label';
    typeLabel.textContent = shape.type;
    row.appendChild(typeLabel);

    const fields = SHAPE_FIELDS[shape.type] || [];
    fields.forEach(([key, kind]) => {
      let input;
      if (kind === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 2;
      } else if (kind.startsWith('select:')) {
        input = document.createElement('select');
        kind.slice(7).split(',').forEach((opt) => {
          const o = document.createElement('option');
          o.value = opt; o.textContent = opt;
          input.appendChild(o);
        });
      } else {
        input = document.createElement('input');
        input.type = kind === 'number' ? 'number' : 'text';
      }
      input.value = shape[key] ?? '';
      input.placeholder = key;
      input.addEventListener('change', () => {
        const value = kind === 'number' ? Number(input.value) : input.value;
        controller.updateShape(slideId, shape.id, { [key]: value });
      });
      row.appendChild(input);
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      const dependents = controller.findDependentArrows(slideId, shape.id);
      if (dependents.length > 0 && !confirm(`This will also remove ${dependents.length} connected arrow(s). Continue?`)) return;
      controller.deleteShape(slideId, shape.id);
    });
    row.appendChild(delBtn);

    return row;
  }

  function render() {
    const slide = getSlide();
    if (!slide) return;
    toggle.checked = !!slide.diagramSpec;
    body.style.display = slide.diagramSpec ? 'block' : 'none';
    if (!slide.diagramSpec) return;

    rowsEl.innerHTML = '';
    slide.diagramSpec.shapes.forEach((shape) => rowsEl.appendChild(renderShapeRow(shape)));

    try { renderDiagram(previewSvg, slide.diagramSpec, { mode: RENDER_MODES.STATIC }); } catch (e) { /* ignore mid-edit races */ }
  }

  controller.on('seminarChanged', ({ slideId: changedId }) => { if (changedId === slideId) render(); });
  render();

  return { render };
}
