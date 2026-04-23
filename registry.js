/**
 * registry.js
 *
 * Shared model algorithm registry.
 *
 * Loads the most recent eval output JSON (either a live `eval-results.json`
 * produced by `npm run eval`, or the bundled `sample-eval-results.json` that
 * ships with the repo so fresh clones have something to show), and exposes
 * a flat list of "entries" that both `results.js` and `ui.js` can consume:
 *
 *   Baselines come from algorithms.js (ALGOS / ALGO_NAMES) — those are the
 *   hand-written reference strategies. Each one becomes a `{ kind: 'baseline' }`
 *   entry keyed by slug.
 *
 *   Model iterations come from the loaded JSON. Every model × iter becomes
 *   a `{ kind: 'model' }` entry keyed by `<model>@<iter>`, carrying the
 *   rawCode string plus summary stats.
 *
 * A compiled function is built lazily via `registry.compile(entry)` and memoized
 * on the entry, so selecting the same algorithm twice is cheap.
 *
 * Load order:
 *   1. `eval-results.json`      (live run output, gitignored)
 *   2. `sample-eval-results.json` (bundled sample, tracked)
 *   If both are missing, the registry falls back to baselines-only.
 */

(function () {
  const SOURCE_CANDIDATES = ['eval-results.json', 'sample-eval-results.json'];

  const state = {
    results: null,
    source: null,
    baselines: [],
    models: [],
    loaded: false,
    loadError: null,
  };

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function stripFences(code) {
    if (!code) return '';
    return String(code).replace(/```[a-z]*/gi, '').replace(/```/g, '').trim();
  }

  function buildBaselineEntries() {
    // algorithms.js declares ALGOS / ALGO_NAMES with `const`, which live in the
    // global lexical environment but do NOT become `window` properties. Access
    // them by bare name (same script global) guarded by typeof to avoid a
    // ReferenceError when algorithms.js isn't loaded (e.g. a test harness).
    // eslint-disable-next-line no-undef
    const hasAlgos = typeof ALGOS !== 'undefined' && Array.isArray(ALGOS);
    if (!hasAlgos) return [];
    // eslint-disable-next-line no-undef
    const names = (typeof ALGO_NAMES !== 'undefined' && Array.isArray(ALGO_NAMES)) ? ALGO_NAMES : [];
    // eslint-disable-next-line no-undef
    return ALGOS.map(function (fn, i) {
      const name = names[i] || (fn.name || ('baseline-' + i));
      return {
        id: 'baseline:' + slugify(name),
        kind: 'baseline',
        index: i,
        name: name,
        displayName: name,
        fn: fn,
      };
    });
  }

  function buildModelEntries(results) {
    if (!results || !results.models) return [];
    const entries = [];
    Object.keys(results.models).forEach(function (modelKey) {
      const modelRec = results.models[modelKey] || {};
      const provider = modelRec.provider || null;
      const iterations = Array.isArray(modelRec.iterations) ? modelRec.iterations : [];
      iterations.forEach(function (iter) {
        if (!iter || typeof iter.rawCode !== 'string') return;
        const iterNum = iter.iter;
        const stats = iter.stats || {};
        const meanPct = Number.isFinite(stats.meanPct) ? stats.meanPct : null;
        const ci95 = Array.isArray(stats.ci95) ? stats.ci95 : null;
        entries.push({
          id: modelKey + '@' + iterNum,
          kind: 'model',
          model: modelKey,
          iter: iterNum,
          provider: provider,
          algoName: iter.algoName || 'myAlgorithm',
          rawCode: iter.rawCode,
          meanPct: meanPct,
          ci95: ci95,
          failureFlags: Array.isArray(iter.failureFlags) ? iter.failureFlags.slice() : [],
          displayName: modelKey + ' · iter ' + iterNum +
            (meanPct != null ? ' (' + meanPct.toFixed(0) + '%)' : ''),
        });
      });
    });
    // Sort by model, then iter. Stable.
    entries.sort(function (a, b) {
      if (a.model !== b.model) return a.model < b.model ? -1 : 1;
      return (a.iter || 0) - (b.iter || 0);
    });
    return entries;
  }

  async function tryFetch(path) {
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) return null;
      const json = await response.json();
      return { json: json, source: path };
    } catch (err) {
      return null;
    }
  }

  async function load() {
    if (state.loaded) {
      return { results: state.results, source: state.source };
    }

    // Baselines are always available synchronously from algorithms.js.
    state.baselines = buildBaselineEntries();

    let loaded = null;
    for (let i = 0; i < SOURCE_CANDIDATES.length; i++) {
      const candidate = SOURCE_CANDIDATES[i];
      // eslint-disable-next-line no-await-in-loop
      loaded = await tryFetch(candidate);
      if (loaded) break;
    }

    if (loaded) {
      state.results = loaded.json;
      state.source = loaded.source;
      state.models = buildModelEntries(loaded.json);
      state.loaded = true;
    } else {
      state.results = null;
      state.source = null;
      state.models = [];
      state.loaded = true;
      state.loadError = 'No eval output found (tried ' + SOURCE_CANDIDATES.join(', ') + ')';
    }

    try {
      window.dispatchEvent(new CustomEvent('registry:loaded', {
        detail: {
          source: state.source,
          modelCount: state.models.length,
          baselineCount: state.baselines.length,
        },
      }));
    } catch (e) { /* no-op */ }

    return { results: state.results, source: state.source };
  }

  function getBaselines() {
    return state.baselines.slice();
  }

  function getModelEntries() {
    return state.models.slice();
  }

  function findEntry(id) {
    if (!id) return null;
    const all = state.baselines.concat(state.models);
    for (let i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  /**
   * Compile an entry into a callable (id, grid, size) => [[r,c], ...] function.
   * Baselines return their cached native function directly. Model entries are
   * lazily compiled from rawCode (fences stripped, wrapped in `new Function`).
   * The compiled function is memoized on the entry.
   */
  function compile(entry) {
    if (!entry) throw new Error('registry.compile: entry is null');
    if (entry.compiled) return entry.compiled;
    if (entry.kind === 'baseline') {
      entry.compiled = entry.fn;
      return entry.compiled;
    }
    const cleaned = stripFences(entry.rawCode);
    if (!cleaned) throw new Error('No code available for ' + entry.id);
    // Mirrors eval-runner.js extractFunction: wrap, locate named function, return reference.
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'const EMPTY = -1;\n' +
      cleaned + '\n' +
      'const match = (' + JSON.stringify(cleaned) + ").match(/function\\s+(\\w+)/);\n" +
      'return match ? eval(match[1]) : undefined;'
    ).call({});
    if (typeof fn !== 'function') {
      throw new Error('No function found in code for ' + entry.id);
    }
    entry.compiled = fn;
    return fn;
  }

  function getResults() {
    return state.results;
  }

  function getSource() {
    return state.source;
  }

  function getLoadError() {
    return state.loadError;
  }

  window.ArenaRegistry = {
    load: load,
    getBaselines: getBaselines,
    getModelEntries: getModelEntries,
    findEntry: findEntry,
    compile: compile,
    getResults: getResults,
    getSource: getSource,
    getLoadError: getLoadError,
  };
})();
