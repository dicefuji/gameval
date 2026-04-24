/**
 * ui.js
 *
 * UI controller for Arena War.
 * Handles canvas rendering, control bindings, stats display,
 * game history, and the model algorithm injection panel.
 *
 * Depends on: algorithms.js (ALGOS, ALGO_NAMES), engine.js (ArenaEngine)
 */

(function () {

  // ─── Palette ───────────────────────────────────────────────────────────────
  const COLORS = [
    '#E87040', // orange
    '#5B9CF6', // blue
    '#6BC98A', // green
    '#C97BE8', // purple
    '#F5C842', // yellow
    '#E85F7A', // pink
    '#40C8C8', // teal
    '#A0A0F0', // lavender
  ];

  // ─── State ─────────────────────────────────────────────────────────────────
  let engine = null;
  let running = false;
  let animId = null;
  let lastFrameTime = 0;
  let msPerTick = 120;
  let history = [];
  let customAlgos = [...ALGOS]; // mutable copy — models inject here
  // Snapshot of the original human-readable baseline names so `Clear` can
  // restore labels after a model override (e.g. ALGO_NAMES[0] = 'gpt-4.1-mini · iter 1').
  // Do NOT use ALGOS[i].name — that returns camelCase JS identifiers like 'greedyBFS'.
  const ORIGINAL_ALGO_NAMES = [...ALGO_NAMES];

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const canvas    = document.getElementById('arena');
  const ctx       = canvas.getContext('2d');
  const tickNum   = document.getElementById('tick-num');
  const statsBody = document.getElementById('stats-body');
  const algoList  = document.getElementById('algo-list');
  const histList  = document.getElementById('history-list');
  const winner    = document.getElementById('winner-banner');
  const speedSlider = document.getElementById('speed');
  const speedVal  = document.getElementById('speed-val');
  const injectSlot = document.getElementById('inject-slot');
  const injectStatus = document.getElementById('inject-status');
  const algoPicker = document.getElementById('algo-picker');
  const algoPickerStatus = document.getElementById('algo-picker-status');
  const btnLoadAlgo = document.getElementById('btn-load-algo');

  function getSize()     { return parseInt(document.getElementById('grid-size').value); }
  function getNPlayers() { return parseInt(document.getElementById('n-players').value); }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    const n = getNPlayers();
    const size = getSize();
    const algos = customAlgos.slice(0, n);
    engine = new ArenaEngine(size, n, algos);
    running = false;
    document.getElementById('btn-start').textContent = 'Start';
    winner.style.display = 'none';
    tickNum.textContent = '0';
    rebuildInjectSlots(n);
    renderCanvas();
    renderStats();
    renderAlgoList();
  }

  // ─── Canvas rendering ──────────────────────────────────────────────────────
  function cellPx() { return Math.min(Math.floor(440 / getSize()), 10); }

  function renderCanvas() {
    if (!engine) return;
    const px = cellPx();
    const { size, grid } = engine;
    canvas.width  = size * px;
    canvas.height = size * px;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = grid[r][c];
        if (v === null) continue;
        ctx.fillStyle = v === -1 ? 'rgba(128,128,128,0.10)' : COLORS[v % COLORS.length];
        ctx.fillRect(c * px, r * px, px, px);
        if (px > 4) {
          ctx.fillStyle = 'rgba(0,0,0,0.07)';
          ctx.fillRect(c * px, r * px, 1, 1);
        }
      }
    }
  }

  // ─── Stats panel ───────────────────────────────────────────────────────────
  function renderStats() {
    if (!engine) return;
    const { scores, totalCells } = engine._getResult(false);
    statsBody.innerHTML = '';
    for (let i = 0; i < engine.nPlayers; i++) {
      const pct = totalCells > 0 ? Math.round((scores[i] / totalCells) * 100) : 0;
      statsBody.innerHTML += `
        <div class="stat-row">
          <div class="swatch" style="background:${COLORS[i % COLORS.length]}"></div>
          <span class="stat-label">${ALGO_NAMES[i % ALGO_NAMES.length]}</span>
          <div class="stat-bar-wrap">
            <div class="stat-bar" style="width:${pct}%;background:${COLORS[i % COLORS.length]}"></div>
          </div>
          <span class="stat-pct">${pct}%</span>
        </div>`;
    }
  }

  function renderAlgoList() {
    if (!engine) return;
    algoList.innerHTML = '';
    for (let i = 0; i < engine.nPlayers; i++) {
      algoList.innerHTML += `
        <div class="stat-row">
          <div class="swatch" style="background:${COLORS[i % COLORS.length]}"></div>
          <span class="stat-label" style="font-size:12px">${ALGO_NAMES[i % ALGO_NAMES.length]}</span>
        </div>`;
    }
  }

  // ─── Game history ──────────────────────────────────────────────────────────
  function logHistory(result) {
    const { scores, totalCells, tick } = result;
    // Clear the empty-state placeholder on first game.
    const emptyState = histList.querySelector('.history-empty');
    if (emptyState) emptyState.remove();
    const winnerIdx = scores.indexOf(Math.max(...scores));
    const entry = document.createElement('div');
    entry.className = 'hist-item';
    entry.textContent = `game ${history.length + 1} · ${tick} ticks · ${ALGO_NAMES[winnerIdx % ALGO_NAMES.length]} wins (${Math.round((scores[winnerIdx] / totalCells) * 100)}%)`;
    histList.prepend(entry);
    history.push({ tick, winnerIdx, scores: [...scores], totalCells });
  }

  // ─── Game loop ─────────────────────────────────────────────────────────────
  function loop(ts) {
    if (!running) return;
    if (ts - lastFrameTime >= msPerTick) {
      lastFrameTime = ts;
      const result = engine.step();
      renderCanvas();
      renderStats();
      tickNum.textContent = result.tick;
      if (result.done) {
        stopGame();
        const winIdx = result.scores.indexOf(Math.max(...result.scores));
        winner.textContent = `winner: ${ALGO_NAMES[winIdx % ALGO_NAMES.length]} — ${Math.round((result.scores[winIdx] / result.totalCells) * 100)}%`;
        winner.style.display = 'block';
        logHistory(result);
        return;
      }
    }
    animId = requestAnimationFrame(loop);
  }

  function startGame() {
    if (running || !engine) return;
    running = true;
    animId = requestAnimationFrame(loop);
  }

  function stopGame() {
    running = false;
    if (animId) cancelAnimationFrame(animId);
  }

  // ─── Algorithm injection ───────────────────────────────────────────────────
  function rebuildInjectSlots(n) {
    injectSlot.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `player ${i + 1} (${ALGO_NAMES[i % ALGO_NAMES.length]})`;
      injectSlot.appendChild(opt);
    }
  }

  function compileAlgorithm(code) {
    if (!code || !code.trim()) throw new Error('no code provided');
    // Strip markdown fences if the model wrapped its output (mirrors extractFunction in eval-runner.js)
    const cleaned = code.replace(/```[a-z]*/gi, '').replace(/```/g, '').trim();
    if (!cleaned) throw new Error('no code provided');
    // eslint-disable-next-line no-new-func
    const fn = new Function(`
      const EMPTY = -1;
      ${cleaned}
      // Return the last declared function (model convention)
      const fns = Object.entries(this).filter(([,v]) => typeof v === 'function');
      return eval((${JSON.stringify(cleaned)}).match(/function\\s+(\\w+)/)?.[1] || 'undefined');
    `).call({});
    if (typeof fn !== 'function') throw new Error('No function found in code');
    return fn;
  }

  document.getElementById('btn-inject').addEventListener('click', () => {
    const code = document.getElementById('algo-code').value.trim();
    const slot = parseInt(injectSlot.value);
    try {
      const fn = compileAlgorithm(code);
      ALGO_NAMES[slot] = fn.name || `Model v${history.length + 1}`;
      customAlgos[slot] = fn;
      injectStatus.textContent = `injected as player ${slot + 1}`;
      stopGame();
      init();
    } catch (e) {
      injectStatus.textContent = `error: ${e.message}`;
    }
  });

  // ─── Control bindings ──────────────────────────────────────────────────────
  document.getElementById('btn-start').addEventListener('click', () => {
    if (running) {
      stopGame();
      document.getElementById('btn-start').textContent = 'Resume';
    } else {
      startGame();
      document.getElementById('btn-start').textContent = 'Pause';
    }
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    stopGame();
    init();
  });

  speedSlider.addEventListener('input', function () {
    const v = parseInt(this.value);
    speedVal.textContent = v;
    msPerTick = Math.round(200 / v);
  });

  document.getElementById('n-players').addEventListener('change', () => { stopGame(); init(); });
  document.getElementById('grid-size').addEventListener('change', () => { stopGame(); init(); });

  document.getElementById('btn-clear-loaded').addEventListener('click', () => {
    customAlgos = [...ALGOS];
    // Restore the original human-readable baseline names in case a model
    // override replaced one (e.g. seat 0 got renamed to 'gpt-4.1-mini · iter 1').
    for (let i = 0; i < ALGO_NAMES.length; i++) ALGO_NAMES[i] = ORIGINAL_ALGO_NAMES[i];
    renderLoadedModelPanel(null);
    if (algoPicker) algoPicker.value = '';
    if (algoPickerStatus) algoPickerStatus.textContent = 'cleared loaded algorithm';
    stopGame();
    init();
  });

  // ─── Algorithm picker (registry-backed) ────────────────────────────────────
  /**
   * Load an entry (baseline or model iteration) into seat 0 and reset the game.
   * Throws on compile failure; caller is responsible for surfacing the message.
   */
  function loadEntryIntoSeat0(entry) {
    const fn = window.ArenaRegistry.compile(entry);
    const nameHint = entry.kind === 'model'
      ? `${entry.model} · iter ${entry.iter}`
      : entry.displayName;
    ALGO_NAMES[0] = nameHint;
    customAlgos[0] = fn;
    stopGame();
    init();
    return nameHint;
  }

  function renderLoadedModelPanel(entry, extra) {
    const panel = document.getElementById('loaded-model-panel');
    const info = document.getElementById('loaded-model-info');
    if (!panel || !info) return;
    if (!entry) {
      panel.classList.remove('visible');
      info.innerHTML = '';
      return;
    }
    let text;
    if (entry.kind === 'model') {
      const pct = Number.isFinite(entry.meanPct) ? ` — <strong>${entry.meanPct.toFixed(0)}% territory</strong>` : '';
      text = `<strong>${entry.model}</strong> · iter ${entry.iter}${pct}`;
    } else {
      text = `baseline: <strong>${entry.displayName}</strong>`;
    }
    info.innerHTML = extra ? `${text} <span style="color:var(--text-muted)">(${extra})</span>` : text;
    panel.classList.add('visible');
  }

  function populateAlgoPicker() {
    if (!algoPicker) return;
    const baselines = window.ArenaRegistry.getBaselines();
    const models = window.ArenaRegistry.getModelEntries();
    algoPicker.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— pick an algorithm —';
    algoPicker.appendChild(placeholder);

    if (baselines.length) {
      const bg = document.createElement('optgroup');
      bg.label = 'Baselines (hand-written)';
      baselines.forEach(entry => {
        const opt = document.createElement('option');
        opt.value = entry.id;
        opt.textContent = entry.displayName;
        bg.appendChild(opt);
      });
      algoPicker.appendChild(bg);
    }

    if (models.length) {
      // Group by model so the dropdown stays scannable with many iterations.
      const byModel = models.reduce((acc, entry) => {
        (acc[entry.model] = acc[entry.model] || []).push(entry);
        return acc;
      }, {});
      Object.keys(byModel).sort().forEach(modelName => {
        const mg = document.createElement('optgroup');
        mg.label = modelName;
        byModel[modelName].forEach(entry => {
          const opt = document.createElement('option');
          opt.value = entry.id;
          const pct = Number.isFinite(entry.meanPct) ? ` · ${entry.meanPct.toFixed(0)}%` : '';
          opt.textContent = `iter ${entry.iter}${pct}`;
          mg.appendChild(opt);
        });
        algoPicker.appendChild(mg);
      });
    }

    if (!models.length && algoPickerStatus) {
      const src = window.ArenaRegistry.getSource();
      algoPickerStatus.textContent = src
        ? 'no model iterations in eval output (baselines only)'
        : 'no eval output found — baselines only';
    } else if (algoPickerStatus) {
      algoPickerStatus.textContent = `${models.length} model iterations available`;
    }
  }

  if (btnLoadAlgo) {
    btnLoadAlgo.addEventListener('click', () => {
      if (!algoPicker) return;
      const id = algoPicker.value;
      if (!id) {
        if (algoPickerStatus) algoPickerStatus.textContent = 'pick an algorithm first';
        return;
      }
      const entry = window.ArenaRegistry.findEntry(id);
      if (!entry) {
        if (algoPickerStatus) algoPickerStatus.textContent = `entry not found: ${id}`;
        return;
      }
      try {
        loadEntryIntoSeat0(entry);
        renderLoadedModelPanel(entry, 'loaded via picker');
        if (algoPickerStatus) algoPickerStatus.textContent = `loaded ${entry.id}`;
      } catch (err) {
        if (algoPickerStatus) algoPickerStatus.textContent = `compile failed: ${err.message}`;
      }
    });
  }

  // ─── Auto-load from URL params ─────────────────────────────────────────────
  async function maybeAutoLoadFromParams() {
    const params = new URLSearchParams(window.location.search);
    const loadModel = params.get('loadModel');
    const loadIter = params.get('loadIter');
    if (!loadModel || loadIter == null) return;

    try {
      const entryId = loadModel + '@' + parseInt(loadIter, 10);
      const entry = window.ArenaRegistry.findEntry(entryId);
      if (!entry) {
        throw new Error(`no registry entry for ${entryId}`);
      }
      loadEntryIntoSeat0(entry);
      renderLoadedModelPanel(entry, 'auto-loaded from URL');
      if (injectStatus) injectStatus.textContent = `auto-loaded ${entry.id}`;
      if (algoPicker) algoPicker.value = entry.id;

      // Clear URL params so refresh doesn't re-fetch.
      // Note: the outer IIFE shadows the global `history` with a local game-history array,
      // so reach for the browser's history explicitly via `window.history`.
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', cleanUrl);
    } catch (err) {
      const panel = document.getElementById('loaded-model-panel');
      const info = document.getElementById('loaded-model-info');
      if (panel) panel.classList.add('visible');
      if (info) info.textContent = `Warning: ${err.message}`;
      if (algoPickerStatus) algoPickerStatus.textContent = `auto-load failed: ${err.message}`;
    }
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────
  init();
  (async function bootRegistry() {
    await window.ArenaRegistry.load();
    populateAlgoPicker();
    await maybeAutoLoadFromParams();
  })();

})();
