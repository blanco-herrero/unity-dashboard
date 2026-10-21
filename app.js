'use strict';

(function () {
  const COLORS = [
    '#4477AA', '#EE7733', '#228833', '#CC6677',
    '#AA3377', '#66AABB', '#666666'
  ];

  const DEFAULTS = {
    mode: 'methods',
    oi: -1,
    mi: 0,
    timing: 'overall',
    relative: true,
    local: false,
    labels: true,
    values: true,
    zoom: false,
    size: 1
  };

  let db;
  let methods;
  let model;
  let state = { ...DEFAULTS };
  let hidden = [];
  let chosen = '';
  let hovered = '';
  let status = '';

  const app = document.getElementById('app');

  function format(value) {
    return Number.isFinite(value)
      ? value.toFixed(3)
      : 'Not available';
  }

  function borderWidth(count) {
    return 1 + 1.3 * Math.sqrt(count || 0);
  }

  function escapeText(value) {
    const amp = String.fromCharCode(38);
    const replacements = {
      38: amp + 'amp;',
      60: amp + 'lt;',
      62: amp + 'gt;',
      34: amp + 'quot;',
      39: amp + '#39;'
    };

    return String(value == null ? '' : value)
      .replace(/[&<>"']/g, character =>
        replacements[character.charCodeAt(0)]
      );
  }

  function median(values) {
    const sorted = values
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    const n = sorted.length;

    if (!n) return null;

    return n % 2
      ? sorted[(n - 1) / 2]
      : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }

  function wrapText(value, maximum) {
    const lines = [];
    let line = '';

    String(value).split(/\s+/).forEach(word => {
      if (line && line.length + word.length + 1 > maximum) {
        lines.push(line);
        line = word;
      } else {
        line += (line ? ' ' : '') + word;
      }
    });

    if (line) lines.push(line);
    return lines;
  }

  function svgText(
    value, x, y, maximum = 90, size = 12,
    spacing = 15, anchor = 'start', bold = false
  ) {
    return '\x3ctext x="' + x +
      '" y="' + y +
      '" font-size="' + size +
      '" text-anchor="' + anchor +
      '" font-weight="' + (bold ? 'bold' : 'normal') +
      '" fill="#20364B">' +
      wrapText(value, maximum).map((line, i) =>
        '\x3ctspan x="' + x +
        '" dy="' + (i ? spacing : 0) + '">' +
        escapeText(line) + '\x3c/tspan>'
      ).join('') +
      '\x3c/text>';
  }

  function validateDataset(data) {
    if (
      !data ||
      !Array.isArray(data.methods) ||
      !Array.isArray(data.objectives) ||
      !Array.isArray(data.categories) ||
      !data.methods.length ||
      !data.objectives.length ||
      !data.categories.length
    ) {
      throw new Error('Missing methods, objectives or categories.');
    }

    const validScore = value =>
      value === null ||
      (
        Number.isFinite(value) &&
        value >= 1 &&
        value <= 5
      );

    const validCount = value =>
      Number.isInteger(value) && value >= 0;

    const methodIDs = new Set();

    data.methods.forEach((row, index) => {
      if (
        !Array.isArray(row) ||
        row.length !== 6 ||
        !Number.isInteger(row[0]) ||
        row[0] < 1 ||
        methodIDs.has(row[0]) ||
        !Number.isInteger(row[1]) ||
        row[1] < 0 ||
        row[1] >= data.categories.length ||
        typeof row[2] !== 'string' ||
        !validScore(row[3]) ||
        !validScore(row[4]) ||
        !validCount(row[5]) ||
        (row[4] === null) !== (row[5] === 0)
      ) {
        throw new Error('Invalid method row ' + (index + 1) + '.');
      }

      methodIDs.add(row[0]);
    });

    const objectiveIDs = new Set();

    data.objectives.forEach(objective => {
      if (
        !Array.isArray(objective) ||
        objective.length !== 3 ||
        typeof objective[0] !== 'string' ||
        objectiveIDs.has(objective[0]) ||
        typeof objective[1] !== 'string' ||
        !Array.isArray(objective[2]) ||
        objective[2].length !== data.methods.length
      ) {
        throw new Error('Invalid objective or method alignment.');
      }

      objectiveIDs.add(objective[0]);

      objective[2].forEach((row, index) => {
        if (
          !Array.isArray(row) ||
          row.length !== 5 ||
          !validScore(row[0]) ||
          !validCount(row[1]) ||
          !validScore(row[2]) ||
          !validCount(row[3]) ||
          !validCount(row[4]) ||
          (row[0] === null) !== (row[1] === 0) ||
          (row[2] === null) !== (row[3] === 0)
        ) {
          throw new Error(
            'Invalid scores or counts at ' +
            objective[0] + ', M' + data.methods[index][0] + '.'
          );
        }
      });
    });

    return data;
  }

  function loadDataset(data) {
    db = validateDataset(data);

    methods = db.methods.map((row, index) => ({
      id: 'M' + row[0],
      category: row[1],
      name: row[2],
      timeliness: row[3],
      evidence: row[4],
      count: row[5],
      index
    }));

    state = { ...DEFAULTS };
    hidden = [];
    chosen = '';
    hovered = '';

    const preferences = db.objectives.reduce(
      (total, objective) =>
        total + objective[2].reduce(
          (subtotal, row) => subtotal + row[4], 0
        ),
      0
    );

    status = methods.length + ' methods · ' +
      db.objectives.length + ' objectives · ' +
      preferences + ' preferred selections.';

    render();
  }

  function calculateView() {
    if (state.mode === 'objectives') {
      const all = db.objectives.map(objective => {
        const row = objective[2][state.mi];

        return {
          id: objective[0],
          name: objective[1],
          evidence: row[0],
          count: row[1],
          subgroupTime: row[2],
          subgroupCount: row[3],
          preference: row[4]
        };
      });

      return {
        all,
        visible: all.filter(row =>
          row.evidence !== null && row.count > 0
        ),
        missing: all.filter(row =>
          row.evidence === null || !row.count
        ),
        missingTime: [],
        area: 42,
        medianX: null,
        medianY: null
      };
    }

    const all = methods.map(method => {
      if (state.oi < 0) {
        return {
          ...method,
          x: method.timeliness,
          preference: null,
          subgroupTime: null,
          subgroupCount: null
        };
      }

      const row = db.objectives[state.oi][2][method.index];

      return {
        ...method,
        evidence: row[0],
        count: row[1],
        subgroupTime: row[2],
        subgroupCount: row[3],
        preference: row[4],
        x: state.timing === 'subgroup'
          ? row[2]
          : method.timeliness
      };
    });

    const rated = all.filter(row =>
      row.evidence !== null && row.count > 0
    );

    const visible = rated.filter(row =>
      row.x !== null && !hidden.includes(row.category)
    );

    const maximumCount = Math.max(
      1, ...rated.map(row => row.count)
    );

    return {
      all,
      visible,
      missing: all.filter(row =>
        row.evidence === null || !row.count
      ),
      missingTime: rated.filter(row => row.x === null),
      maximumCount,
      area: state.oi >= 0 && state.relative
        ? 800 / maximumCount
        : 8,
      medianX: state.oi >= 0 && state.local
        ? median(visible.map(row => row.x))
        : median(methods.map(row => row.timeliness)),
      medianY: state.oi >= 0 && state.local
        ? median(visible.map(row => row.evidence))
        : median(methods.map(row => row.evidence))
    };
  }

  function viewTitle() {
    if (state.mode === 'objectives') {
      return methods[state.mi].id + '. ' + methods[state.mi].name;
    }

    return state.oi < 0
      ? 'Overview — all knowledge objectives'
      : db.objectives[state.oi][1];
  }

  function drawLegends(y, wide) {
    const color = state.mode === 'objectives'
      ? COLORS[methods[state.mi].category]
      : '#879DB1';

    const counts = state.mode === 'objectives'
      ? [1, 5, 10]
      : state.oi >= 0 && state.relative
        ? [
          1,
          Math.max(1, Math.round(model.maximumCount / 2)),
          model.maximumCount
        ]
        : [5, 25, 100];

    let result = svgText(
      'Dot area: evidence assessments',
      100, y, 100, 13, 15, 'start', true
    );

    counts.forEach((count, i) => {
      const x = 135 + i * 100;
      const radius = Math.sqrt(
        count * model.area / Math.PI
      ) * state.size;

      result += '\x3ccircle cx="' + x +
        '" cy="' + (y + 40) +
        '" r="' + radius +
        '" fill="' + color +
        '" stroke="#20364B" stroke-width="1"/>' +
        svgText(count, x, y + 75, 30, 12, 15, 'middle');
    });

    if (state.mode === 'objectives' || state.oi >= 0) {
      result += svgText(
        'Border: preferred selections (count)',
        wide ? 730 : 560,
        y, 100, 13, 15, 'start', true
      );

      [0, 1, 3, 7].forEach((count, i) => {
        const x = (wide ? 755 : 585) + i * 75;

        result += '\x3ccircle cx="' + x +
          '" cy="' + (y + 40) +
          '" r="10" fill="' + color +
          '" stroke="#20364B" stroke-width="' +
          borderWidth(count) + '"/>' +
          svgText(count, x, y + 75, 30, 12, 15, 'middle');
      });
    }

    return result;
  }

  function drawChart() {
    const objectiveMode = state.mode === 'objectives';

    const width = 1180;
    const left = objectiveMode ? 380 : 100;
    const right = objectiveMode ? 1120 : 920;
    const top = objectiveMode ? 115 : 100;

    let rowCursor = top;

    const objectiveRows = objectiveMode
      ? model.all.map(row => {
        const lines = wrapText(row.name, 46);
        const rowHeight = Math.max(57, lines.length * 15 + 18);
        const y = rowCursor + rowHeight / 2;
        rowCursor += rowHeight;
        return { row, y, lines };
      })
      : [];

    const bottom = objectiveMode ? rowCursor + 8 : 900;
    const height = objectiveMode ? bottom + 240 : 1170;

    let minX = 1;
    let maxX = 5;
    let minY = 1;
    let maxY = 5;

    if (!objectiveMode && state.zoom && model.visible.length) {
      const xs = model.visible.map(row => row.x);
      const ys = model.visible.map(row => row.evidence);

      if (model.medianX !== null) xs.push(model.medianX);
      if (model.medianY !== null) ys.push(model.medianY);

      minX = Math.max(
        1, Math.floor((Math.min(...xs) - 0.2) * 2) / 2
      );
      maxX = Math.min(
        5, Math.ceil((Math.max(...xs) + 0.2) * 2) / 2
      );
      minY = Math.max(
        1, Math.floor((Math.min(...ys) - 0.2) * 2) / 2
      );
      maxY = Math.min(
        5, Math.ceil((Math.max(...ys) + 0.2) * 2) / 2
      );
    }

    const X = value =>
      left + (value - minX) / (maxX - minX) * (right - left);

    const Y = value =>
      bottom - (value - minY) / (maxY - minY) * (bottom - top);

    const radius = count =>
      Math.sqrt(count * model.area / Math.PI) * state.size;

    function line(x1, y1, x2, y2, dashed = false) {
      return '\x3cline x1="' + x1 +
        '" y1="' + y1 +
        '" x2="' + x2 +
        '" y2="' + y2 +
        '" stroke="' + (dashed ? '#687785' : '#DDE5ED') + '"' +
        (dashed ? ' stroke-dasharray="7 6"' : '') + '/>';
    }

    function dot(row, x, y) {
      const category = objectiveMode
        ? methods[state.mi].category
        : row.category;

      const description = row.id + ' — ' + row.name +
        '; evidence ' + format(row.evidence) +
        '; assessments ' + row.count +
        '; preferred ' +
        (row.preference === null ? 'not shown' : row.preference);

      return '\x3cg role="button" tabindex="0" data-point="' +
        escapeText(row.id) + '" aria-label="' +
        escapeText(description) + '">' +
        '\x3ctitle>' + escapeText(description) + '\x3c/title>' +
        '\x3ccircle cx="' + x +
        '" cy="' + y +
        '" r="' + radius(row.count) +
        '" fill="' + COLORS[category] +
        '" fill-opacity=".8" stroke="#20364B" stroke-width="' +
        borderWidth(row.preference) + '"/>\x3c/g>';
    }

    let result = '\x3csvg id="figure" ' +
      'xmlns="http://www.w3.org/2000/svg" width="' + width +
      '" height="' + height +
      '" viewBox="0 0 ' + width + ' ' + height +
      '" role="group" aria-label="' + escapeText(viewTitle()) + '">' +
      '\x3crect width="' + width +
      '" height="' + height + '" fill="white"/>' +
      svgText(
        viewTitle(),
        objectiveMode ? 35 : 100,
        objectiveMode ? 35 : 25,
        objectiveMode ? 110 : 95,
        objectiveMode ? 21 : 14,
        objectiveMode ? 24 : 17,
        'start', true
      );

    const stepX = state.zoom && !objectiveMode ? 0.5 : 1;

    for (let tick = minX; tick <= maxX + 0.001; tick += stepX) {
      result += line(X(tick), top - 20, X(tick), bottom) +
        svgText(tick, X(tick), bottom + 25, 30, 13, 15, 'middle');
    }

    if (objectiveMode) {
            objectiveRows.forEach(({ row, y, lines }) => {
        result += line(left - 10, y, right, y) +
          svgText(
            row.name,
            left - 17,
            y - (lines.length - 1) * 7.5 + 4,
            46, 12, 15, 'end'
          );

        if (row.evidence !== null && row.count > 0) {
          result += dot(row, X(row.evidence), y);

          if (state.values) {
            result += svgText(
              row.evidence.toFixed(2),
              X(row.evidence) + radius(row.count) + 11,
              y + 4
            );
          }
        } else {
          result += '\x3crect x="' + (left + 8) +
            '" y="' + (y - 12) +
            '" width="' + (right - left - 16) +
            '" height="38" fill="white"/>' +
            svgText(
              'No evidence ratings available for this method–objective combination (n=0).',
              left + 12, y + 4,
              85, 12, 15
            );
        }
      });

      result += svgText(
        'Mean weight of evidence',
        (left + right) / 2,
        bottom + 62, 100, 17, 15, 'middle'
      ) +
        svgText(
          '1 = weakest; 5 = strongest',
          (left + right) / 2,
          bottom + 85, 100, 13, 15, 'middle'
        ) +
        drawLegends(bottom + 140, true);

    } else {
      const stepY = state.zoom ? 0.5 : 1;

      for (let tick = minY; tick <= maxY + 0.001; tick += stepY) {
        result += line(left, Y(tick), right, Y(tick)) +
          svgText(tick, left - 15, Y(tick) + 4, 30, 13, 15, 'end');
      }

      if (model.medianX !== null) {
        result += line(
          X(model.medianX), top - 20,
          X(model.medianX), bottom, true
        ) +
          svgText(
            'Timeliness median ' + format(model.medianX),
            Math.max(left + 100, Math.min(right - 100, X(model.medianX))),
            top - 35,
            100, 12, 15, 'middle'
          );
      }

      if (model.medianY !== null) {
        result += line(
          left, Y(model.medianY),
          right, Y(model.medianY), true
        ) +
          svgText(
            'Evidence median ' + format(model.medianY),
            right + 15, Y(model.medianY) + 4,
            19, 12, 15
          );
      }

      [...model.visible]
        .sort((a, b) => b.count - a.count)
        .forEach(row => {
          result += dot(row, X(row.x), Y(row.evidence));
        });

      if (state.labels) {
        const positions = model.visible.map(row => ({
          x: X(row.x),
          y: Y(row.evidence) - radius(row.count) - 8,
          targetX: X(row.x),
          targetY: Y(row.evidence) - radius(row.count) - 8
        }));

        for (let iteration = 0; iteration < 110; iteration++) {
          const forces = positions.map(position => [
            (position.targetX - position.x) * 0.03,
            (position.targetY - position.y) * 0.03
          ]);

          for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
              let dx = positions[i].x - positions[j].x;
              let dy = positions[i].y - positions[j].y;

              if (Math.abs(dx) < 32 && Math.abs(dy) < 18) {
                if (Math.hypot(dx, dy) < 0.1) {
                  dx = 1;
                  dy = 1;
                }

                const distance = Math.hypot(dx, dy);
                forces[i][0] += dx / distance;
                forces[i][1] += dy / distance;
                forces[j][0] -= dx / distance;
                forces[j][1] -= dy / distance;
              }
            }
          }

          positions.forEach((position, i) => {
            position.x = Math.max(
              left + 10,
              Math.min(right - 10, position.x + forces[i][0])
            );

            position.y = Math.max(
              top + 8,
              Math.min(bottom - 10, position.y + forces[i][1])
            );
          });
        }

        model.visible.forEach((row, i) => {
          const position = positions[i];

          if (
            Math.hypot(
              position.x - X(row.x),
              position.y -
                (Y(row.evidence) - radius(row.count) - 8)
            ) > 10
          ) {
            result += line(
              X(row.x), Y(row.evidence),
              position.x, position.y + 3
            );
          }

          result += '\x3ctext x="' + position.x +
            '" y="' + position.y +
            '" text-anchor="middle" font-size="11" ' +
            'font-weight="bold" fill="#20364B" stroke="white" ' +
            'stroke-width="3" paint-order="stroke" ' +
            'pointer-events="none">' +
            escapeText(row.id) + '\x3c/text>';
        });
      }

      if (!model.visible.length) {
        result += svgText(
          'No plottable methods in this selection.',
          510, 480, 100, 16, 15, 'middle'
        );
      }

      result += svgText(
        'Mean timeliness (reverse-coded)',
        510, 963, 100, 17, 15, 'middle'
      ) +
        svgText(
          '1 = more than 1 year; 5 = up to 7 days',
          510, 985, 100, 13, 15, 'middle'
        ) +
        '\x3ctext transform="translate(27 490) rotate(-90)" ' +
        'text-anchor="middle" font-size="17" fill="#20364B">' +
        'Mean weight of evidence\x3c/text>' +
        '\x3ctext transform="translate(52 490) rotate(-90)" ' +
        'text-anchor="middle" font-size="13" fill="#20364B">' +
        '1 = weakest; 5 = strongest\x3c/text>' +
        drawLegends(1040, false);
    }

    result += line(left, bottom, right, bottom);

    if (!objectiveMode) {
      result += line(left, top - 20, left, bottom);
    }

    return result + '\x3c/svg>';
  }

  function options(rows, value) {
    return rows.map(row =>
      '\x3coption value="' + escapeText(row[0]) + '" ' +
      (String(row[0]) === String(value) ? 'selected' : '') +
      '>' + escapeText(row[1]) + '\x3c/option>'
    ).join('');
  }

  function checkbox(key, label, disabled = false) {
    return '\x3clabel>\x3cinput type="checkbox" data-setting="' +
      key + '" ' +
      (state[key] ? 'checked ' : '') +
      (disabled ? 'disabled' : '') +
      '>' + escapeText(label) + '\x3c/label>';
  }

  function detailsHTML(row) {
    if (!row) {
      return '\x3cp class="note">' +
        'Hover, click, tap, or use the selector to inspect values.' +
        '\x3c/p>';
    }

    let result = '\x3cdiv class="stats">\x3cstrong>' +
      escapeText(row.id + ' — ' + row.name) +
      '\x3c/strong>\x3cdiv>Mean evidence: ' +
      format(row.evidence) +
      '\x3c/div>\x3cdiv>Evidence assessments: ' + row.count +
      '\x3c/div>\x3cdiv>Preferred selections: ' +
      (row.preference === null
        ? 'Not displayed in overview'
        : row.preference) +
      '\x3c/div>';

    if (state.mode === 'methods') {
      result += '\x3cdiv>Active timeliness: ' +
        format(row.x) + '\x3c/div>';

      if (state.oi >= 0) {
        result += '\x3cdiv>Subgroup timeliness: ' +
          format(row.subgroupTime) +
          '\x3c/div>\x3cdiv>Subgroup timeliness respondents: ' +
          row.subgroupCount + '\x3c/div>';
      }
    }

    return result + '\x3c/div>';
  }

  function render() {
    model = calculateView();

    const objectiveMode = state.mode === 'objectives';

    let html = '\x3cspan class="pill">UNITY · VERSION 2\x3c/span>' +
      '\x3ch1>Timeliness, evidence and methodological preference\x3c/h1>' +
      '\x3cp class="note">Compare methods for an objective, ' +
      'or the evidence a method provides across objectives.\x3c/p>' +
      '\x3csection class="card">\x3cdiv class="controls">' +
      '\x3cbutton data-mode="methods" class="' +
      (!objectiveMode ? 'tab' : '') +
      '">Compare actionability of different methods to achieve objectives\x3c/button>' +
      '\x3cbutton data-mode="objectives" class="' +
      (objectiveMode ? 'tab' : '') +
      '">Compare weight of evidence of a method to achieve different objectives\x3c/button>' +
      '\x3cbutton id="reset">Reset\x3c/button>\x3c/div>' +
      '\x3clabel>\x3cstrong>' +
      (objectiveMode ? 'Method' : 'Knowledge objective') +
      '\x3c/strong>\x3c/label>' +
      '\x3cselect class="selector" data-setting="' +
      (objectiveMode ? 'mi' : 'oi') +
      '" aria-label="' +
      (objectiveMode ? 'Method' : 'Knowledge objective') + '">' +
      options(
        objectiveMode
          ? methods.map((method, index) => [
            index, method.id + ' — ' + method.name
          ])
          : [
            [-1, 'Overview — all objectives'],
            ...db.objectives.map((objective, index) => [
              index, objective[1]
            ])
          ],
        objectiveMode ? state.mi : state.oi
      ) +
      '\x3c/select>\x3cdiv class="controls">';

    if (objectiveMode) {
      html += checkbox('values', 'Show evidence values');
    } else {
      html += '\x3clabel>Timeliness ' +
        '\x3cselect data-setting="timing" ' +
        (state.oi < 0 ? 'disabled' : '') + '>' +
        options([
          ['overall', 'Overall method estimate'],
          ['subgroup', 'Among participants selecting this objective']
        ], state.timing) +
        '\x3c/select>\x3c/label>' +
        checkbox(
          'local', 'Selected-objective medians', state.oi < 0
        ) +
        checkbox(
          'relative', 'Scale bubbles within objective', state.oi < 0
        ) +
        checkbox('labels', 'Method labels') +
        checkbox('zoom', 'Zoom to observed values');
    }

    html += '\x3clabel>Dot size ' +
      '\x3cinput type="range" data-setting="size" ' +
      'min="0.7" max="1.7" step="0.1" value="' +
      state.size + '">\x3c/label>\x3c/div>' +
      '\x3cdiv class="controls">' +
      '\x3cbutton data-export="svg">Export SVG\x3c/button>' +
      '\x3cbutton data-export="png">Export PNG\x3c/button>' +
      '\x3cbutton id="csv">Export view CSV\x3c/button>' +
      '\x3cbutton id="json">Export all data JSON\x3c/button>' +
      '\x3clabel>Load JSON locally ' +
      '\x3cinput id="local" type="file" ' +
      'accept=".json,application/json">\x3c/label>\x3c/div>' +
      '\x3cp class="note">' +
      (
        objectiveMode
          ? 'Objectives remain in their original numbered order. ' +
            'Dot area shows evidence-assessment count; borders ' +
            'show preferred-selection counts.'
          : state.oi < 0
            ? 'The overview uses uniform outlines. Preference-count ' +
              'borders appear for individual objectives.'
            : 'Preference-count borders use a fixed, modest ' +
              'scale across objectives.'
      ) +
      '\x3c/p>';

    if (
      state.oi >= 0 &&
      !objectiveMode &&
      state.timing === 'subgroup'
    ) {
      html += '\x3cp class="note">' +
        'Timeliness was rated once per method. This subgroup includes ' +
        'participants selecting the objective who rated the method, ' +
        'irrespective of whether they selected that method as relevant. ' +
        'These are not direct objective-specific timeliness assessments.' +
        '\x3c/p>';
    }

    html += '\x3cp class="note" id="status" role="status" ' +
      'aria-live="polite">' + escapeText(status) +
      '\x3c/p>\x3c/section>' +
      '\x3cdiv class="layout">\x3cmain class="card plot ' +
      (objectiveMode ? 'objective-plot' : '') + '">' +
      drawChart() +
      '\x3cdiv id="tip" class="tip" hidden>\x3c/div>' +
      '\x3cdetails style="margin:12px">\x3csummary>Missing ratings (' +
      model.missing.length + ' evidence' +
      (model.missingTime.length
        ? '; ' + model.missingTime.length + ' timeliness'
        : '') +
      ')\x3c/summary>\x3cp class="note">No evidence rating: ' +
      (model.missing.length
        ? model.missing.map(row => escapeText(row.id) + '*').join(', ')
        : 'None') +
      '.\x3c/p>';

    if (model.missing.length) {
      html += '\x3cp class="note">' +
        '* Not plotted at zero. Missing evidence may reflect no ' +
        'relevance selection or declining assessment due to lack ' +
        'of knowledge; the dataset does not identify the reason.' +
        '\x3c/p>';
    }

    if (model.missingTime.length) {
      html += '\x3cp class="note">No subgroup timeliness: ' +
        model.missingTime.map(row =>
          escapeText(row.id) + '†'
        ).join(', ') +
        '. † Evidence is available; choose overall timeliness to ' +
        'plot these methods. No values are silently substituted.' +
        '\x3c/p>';
    }

    html += '\x3c/details>';

    if (objectiveMode) {
      html += '\x3cp class="note" style="margin:12px">' +
        'labels and chart.\x3c/p>';
    }

    html += '\x3c/main>\x3caside>\x3csection class="card">\x3ch2>' +
      (objectiveMode ? 'Selected methodology' : 'Broad methodology') +
      '\x3c/h2>';

    if (objectiveMode) {
      html += '\x3cp style="color:' +
        COLORS[methods[state.mi].category] + '">' +
        escapeText(db.categories[methods[state.mi].category]) +
        '\x3c/p>\x3cp class="note">' +
        'A common dot-area scale is used across method-centred views. ' +
        'It differs from the scatterplot scale.\x3c/p>';
    } else {
      html += db.categories.map((category, index) =>
        '\x3cbutton class="category" data-category="' + index +
        '" aria-pressed="' + !hidden.includes(index) +
        '" style="opacity:' +
        (hidden.includes(index) ? 0.4 : 1) + '">' +
        '\x3cspan class="swatch" style="background:' +
        COLORS[index] + '">\x3c/span>' +
        escapeText(category) + '\x3c/button>'
      ).join('') +
        '\x3cp class="note">Click to hide/show. Overview medians ' +
        'remain fixed. Selected-objective medians use currently ' +
        'plotted methods.\x3c/p>';
    }

    html += '\x3c/section>\x3csection class="card">\x3ch2>' +
      (objectiveMode ? 'Objective details' : 'Method details') +
      '\x3c/h2>\x3cselect id="details-select" class="selector" ' +
      'aria-label="Details selector">' +
      options([
        ['', objectiveMode ? 'Select an objective' : 'Select a method'],
        ...model.all.map(row => [row.id, row.id + ' — ' + row.name])
      ], chosen) +
      '\x3c/select>\x3cdiv id="details">\x3c/div>' +
      '\x3cbutton id="clear">Clear selection\x3c/button>' +
      '\x3c/section>\x3csection class="card">' +
      '\x3ch2>View summary\x3c/h2>\x3cdiv class="stats">';

    if (objectiveMode) {
      html += '\x3cdiv>' + model.visible.length +
        ' objectives with evidence\x3c/div>\x3cdiv>' +
        model.missing.length +
        ' objectives without evidence\x3c/div>\x3cdiv>' +
        model.all.reduce((total, row) =>
          total + row.preference, 0
        ) +
        ' preferred selections for this method\x3c/div>';
    } else {
      html += '\x3cdiv>' + model.visible.length +
        ' plotted methods\x3c/div>\x3cdiv>Timeliness median: ' +
        format(model.medianX) +
        '\x3c/div>\x3cdiv>Evidence median: ' +
        format(model.medianY) + '\x3c/div>';

      if (state.oi >= 0) {
        html += '\x3cdiv>' +
          model.all.reduce((total, row) =>
            total + row.preference, 0
          ) +
          ' preferred selections across methods\x3c/div>';
      }
    }

    html += '\x3c/div>';

    if (!objectiveMode && state.oi >= 0 && state.relative) {
      html += '\x3cp class="note">' +
        'The largest evidence count in this objective matches the ' +
        'reference area for 100 overview assessments. Disable ' +
        'within-objective scaling for common count scaling across ' +
        'objective scatterplots.\x3c/p>';
    }

    html += '\x3cp class="note">' +
      'Border thickness increases by a square-root function on a ' +
      'fixed scale across both views. Hover or select for exact counts. ' +
      'Dot size does not change border thickness.\x3c/p>\x3c/section>' +
      '\x3cdetails class="card">' +
      '\x3csummary>Interpretation and data notes\x3c/summary>' +
      '\x3cp class="note">Higher means indicate stronger assessed ' +
      'evidence for a method–objective combination, not guaranteed ' +
      'research outcomes. Preference is a separate judgement and ' +
      'does not increase evidence means.\x3c/p>' +
      '\x3cp class="note">Raw preference counts can reflect the ' +
      'number answering for an objective. No preference percentages ' +
      'are calculated. Assessment counts do not necessarily represent ' +
      'independent respondents or statistical precision; some means ' +
      'use very small samples.\x3c/p>' +
      '\x3cp class="note">Timeliness in the JSON is already ' +
      'reverse-coded (6 minus the original Excel mean). It is not ' +
      'reversed again. Medians are unweighted method medians, ' +
      'not absolute thresholds.\x3c/p>' +
      '\x3cp class="note">Missing scores remain unavailable. Blank ' +
      'preference cells were converted to zero. Original numbering ' +
      'is retained: M24 is absent; M25 has no permanent asterisk.\x3c/p>' +
      '\x3cp class="note">CSV exports include every method or ' +
      'objective in the selected view, including hidden or unplotted ' +
      'rows. Missing scores are empty fields. Full JSON includes ' +
      'the preference-count field.\x3c/p>' +
      '\x3cp class="note">Source: Scatterplot data_Unity dashboard.xlsx. ' +
      'The dataset is loaded from dashboard_dataset.json on this ' +
      'website. No tracking, external libraries or AI calls are used.' +
      '\x3c/p>' +
      '\x3cp class="note">Local JSON loading changes only this browser ' +
      'session. To update public default data, replace ' +
      'dashboard_dataset.json in the repository. The new preference ' +
      'field means this dataset is not directly interchangeable ' +
      'with the old website dataset.\x3c/p>' +
      '\x3c/details>\x3c/aside>\x3c/div>' +
      '\x3cp class="note">UNITY methods dashboard · Version 2\x3c/p>';

    app.innerHTML = html;
    bindEvents();
    updateDetails();
  }

  function setMessage(text) {
    status = text;
    const element = document.getElementById('status');
    if (element) element.textContent = text;
  }

  function updateDetails() {
    const active = hovered || chosen;
    const row = model.all.find(item => item.id === active);
    const tooltip = document.getElementById('tip');

    document.getElementById('details').innerHTML = detailsHTML(row);

    tooltip.hidden = !hovered || !row;
    if (hovered && row) tooltip.innerHTML = detailsHTML(row);

    document.querySelectorAll('[data-point]').forEach(group => {
      group.querySelector('circle').setAttribute(
        'fill-opacity',
        active && group.dataset.point !== active ? '.35' : '.8'
      );
    });
  }

  function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach(button => {
      button.onclick = () => {
        state.mode = button.dataset.mode;
        chosen = '';
        hovered = '';
        render();
      };
    });

    document.querySelectorAll('[data-setting]').forEach(element => {
      element.onchange = () => {
        const key = element.dataset.setting;

        state[key] = element.type === 'checkbox'
          ? element.checked
          : ['oi', 'mi', 'size'].includes(key)
            ? Number(element.value)
            : element.value;

        hovered = '';

        if (['oi', 'mi'].includes(key)) chosen = '';

        render();
      };
    });

    document.getElementById('reset').onclick = () => {
      state = { ...DEFAULTS };
      hidden = [];
      chosen = '';
      hovered = '';
      render();
    };

    document.querySelectorAll('[data-category]').forEach(button => {
      button.onclick = () => {
        const category = Number(button.dataset.category);

        hidden = hidden.includes(category)
          ? hidden.filter(value => value !== category)
          : hidden.concat(category);

        hovered = '';
        render();
      };
    });

    document.querySelectorAll('[data-point]').forEach(group => {
      group.onmouseenter = group.onfocus = () => {
        hovered = group.dataset.point;
        updateDetails();
      };

      group.onmouseleave = group.onblur = () => {
        hovered = '';
        updateDetails();
      };

      group.onclick = () => {
        chosen = group.dataset.point;
        document.getElementById('details-select').value = chosen;
        updateDetails();
      };

      group.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          group.onclick();
        }
      };
    });

    document.getElementById('details-select').onchange = event => {
      chosen = event.target.value;
      hovered = '';
      updateDetails();
    };

    document.getElementById('clear').onclick = () => {
      chosen = '';
      hovered = '';
      document.getElementById('details-select').value = '';
      updateDetails();
    };

    document.querySelectorAll('[data-export]').forEach(button => {
      button.onclick = () => exportFigure(button.dataset.export);
    });

    document.getElementById('csv').onclick = exportCSV;

    document.getElementById('json').onclick = () => {
      download(
        new Blob(
          [JSON.stringify(db, null, 2)],
          { type: 'application/json' }
        ),
        'dashboard_dataset_v2.json'
      );
    };

    document.getElementById('local').onchange = async event => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const text = (await file.text()).replace(/^\uFEFF/, '');
        loadDataset(JSON.parse(text));
        setMessage('Local dataset loaded; public website data unchanged.');
      } catch (error) {
        setMessage('Local file rejected: ' + error.message);
      }
    };
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = name;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function filename() {
    if (state.mode === 'objectives') {
      return methods[state.mi].id + '_objectives';
    }

    return state.oi < 0 ? 'Overview' : db.objectives[state.oi][0];
  }

  function exportCSV() {
    const objectiveMode = state.mode === 'objectives';
    const method = methods[state.mi];

    const headings = objectiveMode
      ? [
        'Method ID',
        'Method name',
        'Objective ID',
        'Objective',
        'Mean weight of evidence',
        'Evidence assessments',
        'Preferred selections'
      ]
      : [
        'View',
        'Method ID',
        'Method name',
        'Broad methodology',
        'Overall reverse-coded timeliness',
        'Active reverse-coded timeliness',
        'Objective-participant reverse-coded timeliness',
        'Objective-participant timeliness respondents',
        'Mean weight of evidence',
        'Evidence assessments',
        'Preferred selections'
      ];

    const rows = objectiveMode
      ? model.all.map(row => [
        method.id,
        method.name,
        row.id,
        row.name,
        row.evidence,
        row.count,
        row.preference
      ])
      : model.all.map(row => [
        viewTitle(),
        row.id,
        row.name,
        db.categories[row.category],
        row.timeliness,
        row.x,
        row.subgroupTime,
        row.subgroupCount,
        row.evidence,
        row.count,
        row.preference
      ]);

    function cell(value) {
      let text = value == null ? '' : String(value);

      if (
        typeof value === 'string' &&
        /^[=+@-]/.test(text)
      ) {
        text = "'" + text;
      }

      return '"' + text.replace(/"/g, '""') + '"';
    }

    const csv = '\uFEFF' + [headings, ...rows]
      .map(row => row.map(cell).join(','))
      .join('\n');

    download(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      filename() + '_data.csv'
    );

    setMessage('CSV download initiated.');
  }

  async function exportFigure(type) {
    try {
      setMessage('Preparing ' + type.toUpperCase() + '…');

      const figure = document.getElementById('figure').cloneNode(true);

      figure.setAttribute(
        'style', 'font-family:Arial,Helvetica,sans-serif'
      );

      figure.querySelectorAll('circle').forEach(circle => {
        circle.setAttribute('fill-opacity', '.8');
      });

      const svg = new Blob(
        [new XMLSerializer().serializeToString(figure)],
        { type: 'image/svg+xml;charset=utf-8' }
      );

      if (type === 'svg') {
        download(svg, filename() + '_figure.svg');
      } else {
        const url = URL.createObjectURL(svg);

        try {
          const image = new Image();

          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () =>
              reject(new Error('SVG rendering failed; try SVG export.'));
            image.src = url;
          });

          const canvas = document.createElement('canvas');

          canvas.width = 2 * Number(figure.getAttribute('width'));
          canvas.height = 2 * Number(figure.getAttribute('height'));

          const context = canvas.getContext('2d');

          if (!context) throw new Error('Canvas unavailable.');

          context.fillStyle = 'white';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);

          const png = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/png');
          });

          if (!png) throw new Error('PNG creation failed.');

          download(png, filename() + '_figure.png');
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      setMessage('Figure download initiated.');

    } catch (error) {
      setMessage('Export failed: ' + error.message);
    }
  }

  async function start() {
    try {
      const response = await fetch(
        './dashboard_dataset.json',
        { cache: 'no-store' }
      );

      if (!response.ok) {
        throw new Error(
          'Dataset request returned HTTP ' + response.status
        );
      }

      loadDataset(await response.json());

    } catch (error) {
      app.innerHTML =
        '\x3csection class="card">' +
        '\x3ch1>Dashboard could not load\x3c/h1>' +
        '\x3cp>' + escapeText(error.message) + '\x3c/p>' +
        '\x3cp>Check that index.html, app.js, styles.css and ' +
        'dashboard_dataset.json are together in the publishing folder. ' +
        'Opening index.html directly from your computer can block ' +
        'JSON loading; use GitHub Pages or a local web server.\x3c/p>' +
        '\x3cbutton id="retry">Retry\x3c/button>\x3c/section>';

      document.getElementById('retry').onclick = start;
    }
  }

  start();
})();
