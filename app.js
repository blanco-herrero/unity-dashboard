'use strict';

(function () {
  const COLORS = ['#4477AA', '#EE7733', '#228833', '#CC6677', '#AA3377', '#66AABB', '#666666'];
  const DEFAULTS = { mode: 'methods', oi: -1, mi: 0, timing: 'overall', relative: true, local: false, labels: true, values: true, sd: true, zoom: false, size: 1 };
  const app = document.getElementById('app');
  let db, methods, model;
  let state = { ...DEFAULTS }, hidden = [], chosen = '', hovered = '', status = '';

  const format = v => Number.isFinite(v) ? v.toFixed(3) : 'Not available';
  const borderWidth = n => 1 + 1.3 * Math.sqrt(n || 0);
  const escapeText = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function median(values) {
    const a = values.filter(Number.isFinite).sort((a, b) => a - b);
    return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null;
  }
  function wrapText(value, maximum) {
    const lines = []; let line = '';
    String(value).split(/\s+/).forEach(word => {
      if (line && line.length + word.length + 1 > maximum) { lines.push(line); line = word; }
      else line += (line ? ' ' : '') + word;
    });
    if (line) lines.push(line);
    return lines;
  }
  function svgText(value, x, y, maximum = 90, size = 12, spacing = 15, anchor = 'start', bold = false, color = '#20364B') {
    return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" font-weight="${bold ? 'bold' : 'normal'}" fill="${color}">${wrapText(value, maximum).map((line, i) => `<tspan x="${x}" dy="${i ? spacing : 0}">${escapeText(line)}</tspan>`).join('')}</text>`;
  }

  // Website schema: objectives = [ID, title, methodRows, optional subtitle].
  // methodRows = [evidenceMean, evidenceCount, subgroupTime, subgroupCount,
  //               preferredCount, optional sampleSD]. Timeliness is already reversed.
  function validateDataset(data) {
    if (!data || !['methods', 'objectives', 'categories'].every(k => Array.isArray(data[k]) && data[k].length)) throw new Error('Missing methods, objectives or categories.');
    if (!data.categories.every(c => typeof c === 'string')) throw new Error('Invalid categories.');
    const score = v => v === null || (Number.isFinite(v) && v >= 1 && v <= 5);
    const count = v => Number.isInteger(v) && v >= 0;
    let ids = new Set();
    data.methods.forEach((r, i) => {
      if (!Array.isArray(r) || r.length !== 6 || !Number.isInteger(r[0]) || r[0] < 1 || ids.has(r[0]) || !count(r[1]) || r[1] >= data.categories.length || typeof r[2] !== 'string' || !score(r[3]) || !score(r[4]) || !count(r[5]) || (r[4] === null) !== (r[5] === 0)) throw new Error('Invalid method row ' + (i + 1) + '.');
      ids.add(r[0]);
    });
    ids = new Set();
    data.objectives.forEach(o => {
      if (!Array.isArray(o) || ![3, 4].includes(o.length) || typeof o[0] !== 'string' || ids.has(o[0]) || typeof o[1] !== 'string' || !Array.isArray(o[2]) || o[2].length !== data.methods.length || (o.length === 4 && typeof o[3] !== 'string')) throw new Error('Invalid objective or method alignment.');
      ids.add(o[0]);
      o[2].forEach((r, i) => {
        if (!Array.isArray(r) || ![5, 6].includes(r.length) || !score(r[0]) || !count(r[1]) || !score(r[2]) || !count(r[3]) || !count(r[4]) || (r[0] === null) !== (r[1] === 0) || (r[2] === null) !== (r[3] === 0) || (r.length === 6 && !(r[5] === null || (Number.isFinite(r[5]) && r[5] >= 0 && r[1] >= 2)))) throw new Error('Invalid scores, counts or SD at ' + o[0] + ', M' + data.methods[i][0] + '.');
      });
    });
    return data;
  }
  function loadDataset(data) {
    const validated = validateDataset(data);
    db = validated;
    methods = db.methods.map((r, index) => ({ id: 'M' + r[0], category: r[1], name: r[2], timeliness: r[3], evidence: r[4], count: r[5], index }));
    state = { ...DEFAULTS }; hidden = []; chosen = ''; hovered = '';
    status = methods.length + ' methods · ' + db.objectives.length + ' objectives · ' + db.objectives.reduce((n, o) => n + o[2].reduce((a, r) => a + r[4], 0), 0) + ' preferred selections.';
    if (!db.objectives.some(o => o[2].some(r => r.length === 6))) status += ' Current dataset has no SD field; whiskers will appear after the dataset update.';
    render();
  }
  function calculateView() {
    if (state.mode === 'objectives') {
      const all = db.objectives.map(o => {
        const r = o[2][state.mi];
        return { id: o[0], name: o[1], evidence: r[0], count: r[1], subgroupTime: r[2], subgroupCount: r[3], preference: r[4], sd: r[5] ?? null };
      });
      return { all, visible: all.filter(r => r.evidence !== null && r.count > 0), missing: all.filter(r => r.evidence === null || !r.count), missingTime: [], area: 42, medianX: null, medianY: null };
    }
    const all = methods.map(m => {
      if (state.oi < 0) return { ...m, x: m.timeliness, preference: null, subgroupTime: null, subgroupCount: null, sd: null };
      const r = db.objectives[state.oi][2][m.index];
      return { ...m, evidence: r[0], count: r[1], subgroupTime: r[2], subgroupCount: r[3], preference: r[4], sd: r[5] ?? null, x: state.timing === 'subgroup' ? r[2] : m.timeliness };
    });
    const rated = all.filter(r => r.evidence !== null && r.count > 0);
    const visible = rated.filter(r => r.x !== null && !hidden.includes(r.category));
    const maximumCount = Math.max(1, ...rated.map(r => r.count));
    return { all, visible, missing: all.filter(r => r.evidence === null || !r.count), missingTime: rated.filter(r => r.x === null), maximumCount, area: state.oi >= 0 && state.relative ? 800 / maximumCount : 8, medianX: state.oi >= 0 && state.local ? median(visible.map(r => r.x)) : median(methods.map(m => m.timeliness)), medianY: state.oi >= 0 && state.local ? median(visible.map(r => r.evidence)) : median(methods.map(m => m.evidence)) };
  }
  function viewTitle() {
    return state.mode === 'objectives' ? methods[state.mi].id + '. ' + methods[state.mi].name : state.oi < 0 ? 'Overview — all knowledge objectives' : db.objectives[state.oi][1];
  }
  function viewSubtitle() {
    return state.mode === 'objectives' ? 'Overall mean timeliness: ' + format(methods[state.mi].timeliness) + ' · Reverse-coded: 1 = slowest; 5 = fastest' : state.oi < 0 ? '' : db.objectives[state.oi][3] || '';
  }
  function drawLegends(y) {
    const om = state.mode === 'objectives';
    const color = om ? COLORS[methods[state.mi].category] : '#879DB1';
    const counts = om ? [1, 5, 10] : state.oi >= 0 && state.relative ? [1, Math.max(1, Math.round(model.maximumCount / 2)), model.maximumCount] : [5, 25, 100];
    let s = svgText('Dot area: evidence assessments', 65, y, 100, 13, 15, 'start', true);
    counts.forEach((n, i) => {
      const x = 110 + i * 110;
      s += `<circle cx="${x}" cy="${y + 40}" r="${Math.sqrt(n * model.area / Math.PI) * state.size}" fill="${color}" stroke="#20364B"/>` + svgText(n, x, y + 85, 30, 12, 15, 'middle');
    });
    if (om || state.oi >= 0) {
      s += svgText('Border: preferred selections (count)', 650, y, 100, 13, 15, 'start', true);
      [0, 1, 3, 7].forEach((n, i) => {
        const x = 680 + i * 85;
        s += `<circle cx="${x}" cy="${y + 40}" r="10" fill="${color}" stroke="#20364B" stroke-width="${borderWidth(n)}"/>` + svgText(n, x, y + 85, 30, 12, 15, 'middle');
      });
    }
    return s;
  }
  function drawChart() {
    const om = state.mode === 'objectives', width = 1180, left = om ? 380 : 100, right = om ? 1120 : 960;
    const titleLines = wrapText(viewTitle(), 110), subtitle = viewSubtitle();
    const subtitleY = 30 + titleLines.length * 23 + 8;
    const top = Math.max(150, subtitleY + (subtitle ? wrapText(subtitle, 125).length * 17 : 0) + 65);
    let cursor = top;
    const rows = om ? model.all.map(row => {
      const lines = wrapText(row.name, 46), height = Math.max(57, lines.length * 15 + 18), y = cursor + height / 2;
      cursor += height;
      return { row, lines, y };
    }) : [];
    const bottom = om ? cursor + 8 : top + 730, height = bottom + 245;
    let minX = om ? 0 : 1, maxX = om ? 6 : 5, minY = 1, maxY = 5;
    if (!om && state.zoom && model.visible.length) {
      const xs = model.visible.map(r => r.x), ys = model.visible.map(r => r.evidence);
      if (model.medianX !== null) xs.push(model.medianX);
      if (model.medianY !== null) ys.push(model.medianY);
      minX = Math.max(1, Math.floor((Math.min(...xs) - .2) * 2) / 2); maxX = Math.min(5, Math.ceil((Math.max(...xs) + .2) * 2) / 2);
      minY = Math.max(1, Math.floor((Math.min(...ys) - .2) * 2) / 2); maxY = Math.min(5, Math.ceil((Math.max(...ys) + .2) * 2) / 2);
    }
    const X = v => left + (v - minX) / (maxX - minX) * (right - left);
    const Y = v => bottom - (v - minY) / (maxY - minY) * (bottom - top);
    const radius = n => Math.sqrt(n * model.area / Math.PI) * state.size;
    const line = (x1, y1, x2, y2, dash = false) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${dash ? '#687785' : '#DDE5ED'}"${dash ? ' stroke-dasharray="7 6"' : ''}/>`;
    function dot(r, x, y) {
      const category = om ? methods[state.mi].category : r.category;
      const description = r.id + ' — ' + r.name + '; evidence ' + format(r.evidence) + '; assessments ' + r.count + '; preferred ' + (r.preference ?? 'not displayed') + (om ? '; sample SD ' + format(r.sd) : '; timeliness ' + format(r.x));
      return `<g role="button" tabindex="0" data-point="${escapeText(r.id)}" aria-label="${escapeText(description)}"><title>${escapeText(description)}</title><circle cx="${x}" cy="${y}" r="${radius(r.count)}" fill="${COLORS[category]}" fill-opacity=".8" stroke="#20364B" stroke-width="${borderWidth(r.preference)}"/></g>`;
    }
    let s = `<svg id="figure" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeText(viewTitle())}"><rect width="${width}" height="${height}" fill="white"/>` + svgText(viewTitle(), 30, 30, 110, 18, 23, 'start', true);
    if (subtitle) s += svgText(subtitle, 30, subtitleY, 125, 13, 17, 'start', false, '#66788A');
    if (om) s += `<rect x="${X(1)}" y="${top - 18}" width="${X(5) - X(1)}" height="${bottom - top + 18}" fill="#F0F5FA"/>` + svgText('Valid rating scale: 1–5 (shaded); plotting range: 0–6', left, top - 35, 100, 12);
    const stepX = !om && state.zoom ? .5 : 1;
    for (let t = minX; t <= maxX + .001; t += stepX) s += line(X(t), top - 18, X(t), bottom) + svgText(t, X(t), bottom + 25, 30, 13, 15, 'middle');
    if (om) {
      rows.forEach(({ row: r, lines, y }) => {
        s += line(left, y, right, y) + svgText(r.name, left - 17, y - (lines.length - 1) * 7.5 + 4, 46, 12, 15, 'end');
        if (r.evidence !== null && r.count > 0) {
          if (state.sd && r.sd !== null) {
            const a = X(r.evidence - r.sd), b = X(r.evidence + r.sd);
            s += `<g stroke="#20364B" stroke-width="1.5"><title>Mean ±1 SD: ${format(r.evidence - r.sd)}–${format(r.evidence + r.sd)}</title><line x1="${a}" y1="${y}" x2="${b}" y2="${y}"/><line x1="${a}" y1="${y - 6}" x2="${a}" y2="${y + 6}"/><line x1="${b}" y1="${y - 6}" x2="${b}" y2="${y + 6}"/></g>`;
          }
          s += dot(r, X(r.evidence), y);
          if (state.values) s += svgText(r.evidence.toFixed(2), X(r.evidence) + radius(r.count) + 9, y - 10);
        } else s += `<rect x="${left + 1}" y="${y - 20}" width="${right - left - 2}" height="38" fill="white"/>` + svgText('No evidence ratings available for this method–objective combination (n=0).', left + 9, y - 3, 85, 12, 15, 'start', false, '#66788A');
      });
      s += svgText('Mean weight of evidence', (left + right) / 2, bottom + 62, 100, 17, 15, 'middle') + svgText('1 = weakest; 5 = strongest · Whiskers: mean ±1 sample SD, not CI', (left + right) / 2, bottom + 85, 120, 13, 15, 'middle');
    } else {
      const stepY = state.zoom ? .5 : 1;
      for (let t = minY; t <= maxY + .001; t += stepY) s += line(left, Y(t), right, Y(t)) + svgText(t, left - 15, Y(t) + 4, 30, 13, 15, 'end');
      if (model.medianX !== null) s += line(X(model.medianX), top - 18, X(model.medianX), bottom, true) + svgText('Timeliness median ' + format(model.medianX), Math.max(left + 100, Math.min(right - 100, X(model.medianX))), top - 35, 100, 12, 15, 'middle');
      if (model.medianY !== null) s += line(left, Y(model.medianY), right, Y(model.medianY), true) + svgText('Evidence median ' + format(model.medianY), right + 15, Y(model.medianY) + 4, 19, 12);
      [...model.visible].sort((a, b) => b.count - a.count).forEach(r => { s += dot(r, X(r.x), Y(r.evidence)); });
      if (state.labels) {
        const positions = model.visible.map(r => ({ x: X(r.x), y: Y(r.evidence) - radius(r.count) - 8, targetX: X(r.x), targetY: Y(r.evidence) - radius(r.count) - 8 }));
        for (let iteration = 0; iteration < 110; iteration++) {
          const forces = positions.map(p => [(p.targetX - p.x) * .03, (p.targetY - p.y) * .03]);
          for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
            let dx = positions[i].x - positions[j].x, dy = positions[i].y - positions[j].y;
            if (Math.abs(dx) < 32 && Math.abs(dy) < 18) {
              if (Math.hypot(dx, dy) < .1) { dx = 1; dy = 1; }
              const dist = Math.hypot(dx, dy);
              forces[i][0] += dx / dist; forces[i][1] += dy / dist; forces[j][0] -= dx / dist; forces[j][1] -= dy / dist;
            }
          }
          positions.forEach((p, i) => { p.x = Math.max(left + 10, Math.min(right - 10, p.x + forces[i][0])); p.y = Math.max(top + 8, Math.min(bottom - 10, p.y + forces[i][1])); });
        }
        model.visible.forEach((r, i) => {
          const p = positions[i];
          if (Math.hypot(p.x - p.targetX, p.y - p.targetY) > 10) s += line(X(r.x), Y(r.evidence), p.x, p.y + 3);
          s += `<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="11" font-weight="bold" fill="#20364B" stroke="white" stroke-width="3" paint-order="stroke" pointer-events="none">${escapeText(r.id)}</text>`;
        });
      }
      if (!model.visible.length) s += svgText('No plottable methods in this selection.', (left + right) / 2, (top + bottom) / 2, 100, 16, 15, 'middle');
      s += svgText('Mean timeliness (reverse-coded)', (left + right) / 2, bottom + 63, 100, 17, 15, 'middle') + svgText('1 = more than 1 year; 5 = up to 7 days', (left + right) / 2, bottom + 85, 100, 13, 15, 'middle') + `<text transform="translate(27 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="17" fill="#20364B">Mean weight of evidence</text><text transform="translate(52 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="#20364B">1 = weakest; 5 = strongest</text>` + line(left, top - 18, left, bottom);
    }
    return s + drawLegends(bottom + 140) + line(left, bottom, right, bottom) + '</svg>';
  }

  function options(rows, value) { return rows.map(r => `<option value="${escapeText(r[0])}" ${String(r[0]) === String(value) ? 'selected' : ''}>${escapeText(r[1])}</option>`).join(''); }
  function checkbox(key, label, disabled = false) { return `<label><input type="checkbox" data-setting="${key}" ${state[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${escapeText(label)}</label>`; }
  function detailsHTML(r) {
    if (!r) return '<p class="note">Hover, click, tap, or use the selector to inspect values.</p>';
    let s = `<div class="stats"><strong>${escapeText(r.id + ' — ' + r.name)}</strong><div>Mean evidence: ${format(r.evidence)}</div><div>Evidence assessments: ${r.count}</div><div>Preferred selections: ${r.preference ?? 'Not displayed in overview'}</div>`;
    if (state.mode === 'methods') {
      s += `<div>Overall timeliness: ${format(r.timeliness)}</div><div>Active timeliness: ${format(r.x)}</div>`;
      if (state.oi >= 0) s += `<div>Subgroup timeliness: ${format(r.subgroupTime)}</div><div>Subgroup timeliness respondents: ${r.subgroupCount}</div>`;
    } else {
      s += `<div>Sample SD: ${format(r.sd)}</div>`;
      if (r.sd !== null) s += `<div>Mean ±1 SD: ${format(r.evidence - r.sd)}–${format(r.evidence + r.sd)}</div>`;
      if (r.count === 1) s += '<p class="note">Only one rating: sample SD cannot be calculated.</p>';
      if (r.count === 2) s += '<p class="note">Based on only two ratings; dispersion estimate is unstable.</p>';
      if (r.count >= 2 && r.sd === 0) s += '<p class="note">All observed ratings agree; this does not establish broader expert consensus.</p>';
      if (!r.count) s += '<p class="note">No evidence ratings available for this method–objective combination (n=0).</p>';
    }
    return s + '</div>';
  }
  function render() {
    model = calculateView();
    const om = state.mode === 'objectives', selectorLabel = om ? 'Select an objective' : 'Select a method';
    let html = `<span class="pill">UNITY · VERSION 3</span><h1>Timeliness, evidence and methodological preference</h1><p class="note">Compare actionability across methods, or a method’s assessed weight of evidence across objectives.</p><section class="card"><div class="controls mode-controls"><button data-mode="methods" class="${!om ? 'tab' : ''}">Compare actionability of different methods to achieve objectives</button><button data-mode="objectives" class="${om ? 'tab' : ''}">Compare weight of evidence of a method to achieve different objectives</button><button id="reset">Reset</button></div><label><strong>${om ? 'Method' : 'Knowledge objective'}</strong></label><select class="selector" data-setting="${om ? 'mi' : 'oi'}" aria-label="${om ? 'Method' : 'Knowledge objective'}">${options(om ? methods.map((m, i) => [i, m.id + ' — ' + m.name]) : [[-1, 'Overview — all objectives'], ...db.objectives.map((o, i) => [i, o[1]])], om ? state.mi : state.oi)}</select><div class="controls">`;
    if (om) html += checkbox('sd', 'Show mean ±1 SD whiskers') + checkbox('values', 'Show evidence values');
    else html += `<label>Timeliness <select data-setting="timing" ${state.oi < 0 ? 'disabled' : ''}>${options([['overall', 'Overall method estimate'], ['subgroup', 'Among participants selecting this objective']], state.timing)}</select></label>` + checkbox('local', 'Selected-objective medians', state.oi < 0) + checkbox('relative', 'Scale bubbles within objective', state.oi < 0) + checkbox('labels', 'Method labels') + checkbox('zoom', 'Zoom to observed values');
    html += `<label>Dot size <input type="range" data-setting="size" min="0.7" max="1.7" step="0.1" value="${state.size}"></label></div><div class="controls"><button data-export="svg">Export SVG</button><button data-export="png">Export PNG</button><button id="csv">Export view CSV</button><button id="json">Export all data JSON</button><label>Load JSON locally <input id="local" type="file" accept=".json,application/json"></label></div><p class="note">${om ? 'Objectives remain in numbered order. Whiskers show mean ±1 sample SD, not confidence intervals. Shading marks the valid 1–5 rating scale; the plot extends from 0 to 6.' : state.oi < 0 ? 'The overview uses uniform outlines. Preference-count borders appear for individual objectives.' : 'Preference-count borders use a fixed scale across objectives.'}</p>`;
    if (!om && state.oi >= 0 && state.timing === 'subgroup') html += '<p class="note">Timeliness was rated once per method. This subgroup includes participants selecting the objective who rated the method, irrespective of whether they selected that method as relevant. These are not direct objective-specific timeliness assessments.</p>';
    html += `<p class="note" id="status" role="status" aria-live="polite">${escapeText(status)}</p></section><div class="layout"><main class="card plot ${om ? 'objective-plot' : ''}">${drawChart()}<div id="tip" class="tip" hidden></div><details style="margin:12px"><summary>Missing ratings (${model.missing.length} evidence${model.missingTime.length ? '; ' + model.missingTime.length + ' timeliness' : ''})</summary><p class="note">No evidence ratings: ${model.missing.length ? model.missing.map(r => escapeText(r.id) + '*').join(', ') : 'None'}.</p>`;
    if (model.missing.length) html += '<p class="note">* Not plotted at zero. Missing evidence may reflect no relevance selection or declining assessment due to lack of knowledge; the dataset does not identify the reason.</p>';
    if (model.missingTime.length) html += `<p class="note">No subgroup timeliness: ${model.missingTime.map(r => escapeText(r.id) + '†').join(', ')}. † Evidence is available; choose overall timeliness to plot these methods. No values are silently substituted.</p>`;
    html += '</details>' + (om ? '<p class="note" style="margin:12px">Long objective descriptions wrap onto multiple lines. The figure is designed to fit the available width once the updated stylesheet is installed.</p>' : '') + `</main><aside><section class="card"><h2>${om ? 'Selected methodology' : 'Broad methodology'}</h2>`;
    if (om) html += `<p style="color:${COLORS[methods[state.mi].category]}">${escapeText(db.categories[methods[state.mi].category])}</p><p class="note">A common dot-area scale is used across method-centred views. It differs from the scatterplot scale.</p>`;
    else html += db.categories.map((c, i) => `<button class="category" data-category="${i}" aria-pressed="${!hidden.includes(i)}" style="opacity:${hidden.includes(i) ? .4 : 1}"><span class="swatch" style="background:${COLORS[i]}"></span>${escapeText(c)}</button>`).join('') + '<p class="note">Click to hide/show. Overview medians remain fixed; selected-objective medians use currently plotted methods.</p>';
    html += `</section><section class="card"><h2>${om ? 'Objective details' : 'Method details'}</h2><select id="details-select" class="selector" aria-label="${selectorLabel}">${options([['', selectorLabel], ...model.all.map(r => [r.id, r.id + ' — ' + r.name])], chosen)}</select><div id="details"></div><button id="clear">Clear selection</button></section><section class="card"><h2>View summary</h2><div class="stats"><div>${model.visible.length} ${om ? 'objectives with evidence' : 'plotted methods'}</div><div>${model.missing.length} without evidence ratings</div>`;
    if (!om) html += `<div>Timeliness median: ${format(model.medianX)}</div><div>Evidence median: ${format(model.medianY)}</div>`;
    if (om || state.oi >= 0) html += `<div>${model.all.reduce((n, r) => n + (r.preference || 0), 0)} preferred selections</div>`;
    html += '</div>';
    if (!om && state.oi >= 0 && state.relative) html += '<p class="note">The largest evidence count in this objective matches the reference area for 100 overview assessments. Disable within-objective scaling for common count scaling across objective scatterplots.</p>';
    html += '<p class="note">Border thickness uses a fixed square-root function across both views. Dot size does not change border thickness.</p></section><details class="card"><summary>Interpretation and data notes</summary><p class="note">SD whiskers describe observed variation in ratings, not precision of the mean or confidence intervals. Dispersion estimates can be unstable with few assessments. Zero SD means agreement among the observed ratings, not necessarily broad expert consensus. Fewer than two ratings have no SD whiskers.</p><p class="note">Higher evidence means are assessments, not guaranteed research outcomes. Preference is a separate judgement and does not increase evidence means. Raw preference counts can reflect how many people answered for an objective. No preference percentages are calculated.</p><p class="note">Dot area represents evidence-assessment count, not statistical precision. Within-objective bubble areas cannot be compared across objectives. Timeliness in JSON is already reverse-coded (6 minus the original workbook mean); it is not reversed again. Medians are unweighted method medians, not absolute thresholds.</p><p class="note">Missing scores remain unavailable. Blank preference cells were converted to zero. M24 is absent; M25 retains its number without a permanent asterisk. Objective subtitles appear only in the selected-objective actionability view.</p><p class="note">CSV exports include every row in the selected view, including hidden or unplotted rows. Missing SDs and scores are empty fields. SD endpoints are descriptive values and may extend outside the rating scale.</p><p class="note">Source: Scatterplot data_Unity dashboard.xlsx. The website loads dashboard_dataset.json. No tracking, external libraries or AI calls are used. Local JSON loading changes only this browser session. Version 3 adds SDs and objective subtitles; older version 2 datasets remain loadable without those additions.</p></details></aside></div><p class="note">UNITY methods dashboard · Version 3</p>';
    app.innerHTML = html;
    bindEvents(); updateDetails();
  }
  function setMessage(text) { status = text; const el = document.getElementById('status'); if (el) el.textContent = text; }
  function updateDetails() {
    const active = hovered || chosen, row = model.all.find(r => r.id === active), tip = document.getElementById('tip');
    document.getElementById('details').innerHTML = detailsHTML(row);
    tip.hidden = !hovered || !row;
    if (hovered && row) tip.innerHTML = detailsHTML(row);
    document.querySelectorAll('[data-point]').forEach(g => g.querySelector('circle').setAttribute('fill-opacity', active && g.dataset.point !== active ? '.35' : '.8'));
  }
  function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { state.mode = b.dataset.mode; chosen = ''; hovered = ''; render(); }; });
    document.querySelectorAll('[data-setting]').forEach(el => { el.onchange = () => {
      const key = el.dataset.setting;
      state[key] = el.type === 'checkbox' ? el.checked : ['oi', 'mi', 'size'].includes(key) ? Number(el.value) : el.value;
      hovered = ''; if (['oi', 'mi'].includes(key)) chosen = ''; render();
    }; });
    document.getElementById('reset').onclick = () => { state = { ...DEFAULTS }; hidden = []; chosen = ''; hovered = ''; render(); };
    document.querySelectorAll('[data-category]').forEach(b => { b.onclick = () => { const c = Number(b.dataset.category); hidden = hidden.includes(c) ? hidden.filter(v => v !== c) : [...hidden, c]; hovered = ''; render(); }; });
    document.querySelectorAll('[data-point]').forEach(g => {
      g.onmouseenter = g.onfocus = () => { hovered = g.dataset.point; updateDetails(); };
      g.onmouseleave = g.onblur = () => { hovered = ''; updateDetails(); };
      g.onclick = () => { chosen = g.dataset.point; document.getElementById('details-select').value = chosen; updateDetails(); };
      g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.onclick(); } };
    });
    document.getElementById('details-select').onchange = e => { chosen = e.target.value; hovered = ''; updateDetails(); };
    document.getElementById('clear').onclick = () => { chosen = ''; hovered = ''; document.getElementById('details-select').value = ''; updateDetails(); };
    document.querySelectorAll('[data-export]').forEach(b => { b.onclick = () => exportFigure(b.dataset.export); });
    document.getElementById('csv').onclick = exportCSV;
    document.getElementById('json').onclick = () => download(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }), 'dashboard_dataset_v3.json');
    document.getElementById('local').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      try { loadDataset(JSON.parse((await file.text()).replace(/^\uFEFF/, ''))); setMessage('Local dataset loaded; public website data unchanged.'); }
      catch (error) { setMessage('Local file rejected: ' + error.message); }
    };
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function filename() { return state.mode === 'objectives' ? methods[state.mi].id + '_objectives' : state.oi < 0 ? 'Overview' : db.objectives[state.oi][0]; }
  function exportCSV() {
    const om = state.mode === 'objectives', m = methods[state.mi];
    const headings = om ? ['Method ID', 'Method name', 'Objective ID', 'Objective', 'Mean weight of evidence', 'Evidence assessments', 'Preferred selections', 'Evidence sample SD', 'Mean minus SD', 'Mean plus SD', 'Overall reverse-coded timeliness'] : ['View', 'Method ID', 'Method name', 'Broad methodology', 'Overall reverse-coded timeliness', 'Active reverse-coded timeliness', 'Objective-participant reverse-coded timeliness', 'Objective-participant timeliness respondents', 'Mean weight of evidence', 'Evidence assessments', 'Preferred selections', 'Evidence sample SD'];
    const rows = om ? model.all.map(r => [m.id, m.name, r.id, r.name, r.evidence, r.count, r.preference, r.sd, r.sd === null || r.evidence === null ? null : r.evidence - r.sd, r.sd === null || r.evidence === null ? null : r.evidence + r.sd, m.timeliness]) : model.all.map(r => [viewTitle(), r.id, r.name, db.categories[r.category], r.timeliness, r.x, r.subgroupTime, r.subgroupCount, r.evidence, r.count, r.preference, r.sd]);
    function cell(v) { let text = v == null ? '' : String(v); if (typeof v === 'string' && /^[=+@-]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; }
    download(new Blob(['\uFEFF' + [headings, ...rows].map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), filename() + '_data.csv');
    setMessage('CSV download initiated.');
  }
  async function exportFigure(type) {
    try {
      setMessage('Preparing ' + type.toUpperCase() + '…');
      const figure = document.getElementById('figure').cloneNode(true);
      figure.setAttribute('style', 'font-family:Arial,Helvetica,sans-serif');
      figure.querySelectorAll('circle').forEach(c => c.setAttribute('fill-opacity', '.8'));
      const svg = new Blob([new XMLSerializer().serializeToString(figure)], { type: 'image/svg+xml;charset=utf-8' });
      if (type === 'svg') download(svg, filename() + '_figure.svg');
      else {
        const url = URL.createObjectURL(svg);
        try {
          const image = new Image();
          await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('SVG rendering failed; try SVG export.')); image.src = url; });
          const canvas = document.createElement('canvas');
          canvas.width = 2 * Number(figure.getAttribute('width')); canvas.height = 2 * Number(figure.getAttribute('height'));
          const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable.');
          context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!png) throw new Error('PNG creation failed.');
          download(png, filename() + '_figure.png');
        } finally { URL.revokeObjectURL(url); }
      }
      setMessage('Figure download initiated.');
    } catch (error) { setMessage('Export failed: ' + error.message); }
  }
  async function start() {
    try {
      const response = await fetch('./dashboard_dataset.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Dataset request returned HTTP ' + response.status);
      loadDataset(await response.json());
    } catch (error) {
      app.innerHTML = '<section class="card"><h1>Dashboard could not load</h1><p>' + escapeText(error.message) + '</p><p>Check that index.html, app.js, styles.css and dashboard_dataset.json are together in the publishing folder. Use GitHub Pages or a local web server, rather than opening index.html directly.</p><button id="retry">Retry</button></section>';
      document.getElementById('retry').onclick = start;
    }
  }
  start();
})();

