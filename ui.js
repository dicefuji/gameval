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
    document.getElementById('loaded-model-panel').style.display = 'none';
    injectStatus.textContent = 'cleared loaded model';
    stopGame();
    init();
  });

  // ─── Auto-load from URL params ─────────────────────────────────────────────
  async function maybeAutoLoadFromParams() {
    const params = new URLSearchParams(window.location.search);
    const loadModel = params.get('loadModel');
    const loadIter = params.get('loadIter');
    if (!loadModel || loadIter == null) return;

    const panel = document.getElementById('loaded-model-panel');
    const info = document.getElementById('loaded-model-info');

    try {
      const response = await fetch('eval-results.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load eval-results.json (${response.status})`);
      const data = await response.json();

      // Support both normalized and legacy single-model schemas
      let models = data.models;
      if (!models && data.model && Array.isArray(data.iterations)) {
        models = {
          [data.model]: {
            iterations: data.iterations,
          },
        };
      }

      const modelData = models?.[loadModel];
      if (!modelData) throw new Error(`Model "${loadModel}" not found in results`);

      const iterations = Array.isArray(modelData.iterations) ? modelData.iterations : [];
      const targetIter = parseInt(loadIter, 10);
      const iteration = iterations.find(iter => iter.iter === targetIter);
      if (!iteration) throw new Error(`Iteration ${loadIter} not found for model "${loadModel}"`);

      const rawCode = iteration.rawCode;
      if (!rawCode) throw new Error(`No raw code available for ${loadModel} iteration ${loadIter}`);

      const fn = compileAlgorithm(rawCode);
      const nameHint = iteration.algoName || fn.name || loadModel;
      ALGO_NAMES[0] = nameHint;
      customAlgos[0] = fn;

      stopGame();
      init();

      if (panel) panel.style.display = 'block';
      if (info) info.textContent = `Loaded model algorithm: ${loadModel} iteration ${targetIter}`;
      if (injectStatus) injectStatus.textContent = `auto-loaded ${loadModel} iter ${targetIter}`;

      // Clear URL params so refresh doesn't re-fetch.
      // Note: the outer IIFE shadows the global `history` with a local game-history array,
      // so reach for the browser's history explicitly via `window.history`.
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', cleanUrl);
    } catch (err) {
      if (panel) panel.style.display = 'block';
      if (info) info.textContent = `Warning: ${err.message}`;
      if (injectStatus) injectStatus.textContent = `auto-load failed: ${err.message}`;
      // Leave arena in default state (init() already ran before this)
    }
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────
  init();
  maybeAutoLoadFromParams();

})();
