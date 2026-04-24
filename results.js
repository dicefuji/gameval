(function () {
  const COLORS = [
    '#E87040',
    '#5B9CF6',
    '#6BC98A',
    '#C97BE8',
    '#F5C842',
    '#E85F7A',
    '#40C8C8',
    '#A0A0F0',
  ];

  const emptyState = document.getElementById('empty-state');
  const content = document.getElementById('content');
  const summaryGrid = document.getElementById('summary-grid');
  const verdictGrid = document.getElementById('verdict-grid');
  const protocolGrid = document.getElementById('protocol-grid');
  const comparisonTableBody = document.getElementById('comparison-table-body');
  const learningCurve = document.getElementById('learning-curve');
  const chartLegend = document.getElementById('chart-legend');
  const modelSelect = document.getElementById('model-select');
  const iterationSelect = document.getElementById('iteration-select');
  const modelSummary = document.getElementById('model-summary');
  const iterationMeta = document.getElementById('iteration-meta');
  const rewardSignals = document.getElementById('reward-signals');
  const leaderboardSnapshot = document.getElementById('leaderboard-snapshot');
  const historySnapshot = document.getElementById('history-snapshot');
  const codeViewer = document.getElementById('code-viewer');
  const miniArenaCanvas = document.getElementById('mini-arena-canvas');
  const miniArenaToggle = document.getElementById('mini-arena-toggle');
  const miniArenaTick = document.getElementById('mini-arena-tick');
  const miniArenaOpen = document.getElementById('mini-arena-open');
  const miniArenaLegend = document.getElementById('mini-arena-legend');
  const snapshotMeta = document.getElementById('snapshot-meta');
  const followOn = document.getElementById('follow-on');
  const headToHeadMatrix = document.getElementById('head-to-head-matrix');
  const failureTaxonomy = document.getElementById('failure-taxonomy');
  const versionBadge = document.getElementById('version-badge');
  const chartTooltip = document.getElementById('chart-tooltip');
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const themeLabel = document.getElementById('theme-label');
  const referencePanel = document.getElementById('reference-panel');
  const referenceSummary = document.getElementById('reference-summary');
  const referenceGrid = document.getElementById('reference-grid');
  const pairwisePanel = document.getElementById('pairwise-panel');
  const pairwiseGrid = document.getElementById('pairwise-grid');
  const filterStrip = document.getElementById('leaderboard-filter');
  const filterCount = document.getElementById('filter-count');

  const state = {
    results: null,
    modelKeys: [],
    selectedModel: null,
    selectedIteration: null,
    filter: 'all',
    expandedRows: new Set(),
  };

  // Mini-arena runtime state (lives outside state so it's easy to tear down).
  const miniArena = {
    engine: null,
    loopId: null,
    paused: false,
    tick: 0,
    entryId: null,
    error: null,
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function metricCard(value, label) {
    return `
      <div class="panel" style="padding:14px">
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-label">${escapeHtml(label)}</div>
      </div>
    `;
  }

  function metaItem(label, value) {
    return `
      <div class="meta-item">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(value)}</span>
      </div>
    `;
  }

  function listRow(left, right) {
    return `
      <div class="list-row">
        <span>${escapeHtml(left)}</span>
        <strong>${escapeHtml(right)}</strong>
      </div>
    `;
  }

  function successfulIterationsFor(modelResult) {
    return modelResult.iterations.filter(iter => !iter.error && typeof iter.avgPct === 'number');
  }

  function normalizeComparisonEntry(modelName) {
    const modelResult = state.results.models[modelName];
    const successfulIterations = successfulIterationsFor(modelResult);
    const firstIteration = successfulIterations[0] || null;
    const latestIteration = successfulIterations[successfulIterations.length - 1] || null;
    const bestIteration = modelResult.summary.bestIteration || null;
    const latestAvgPct = modelResult.summary.latestIteration?.avgPct ?? latestIteration?.avgPct ?? null;
    const firstAvgPct = firstIteration?.avgPct ?? null;
    const netImprovement = (firstAvgPct == null || latestAvgPct == null) ? null : latestAvgPct - firstAvgPct;
    const peakGain = (firstAvgPct == null || bestIteration?.avgPct == null) ? null : bestIteration.avgPct - firstAvgPct;
    const improvementRate = (netImprovement == null || successfulIterations.length <= 1)
      ? null
      : netImprovement / (successfulIterations.length - 1);

    return {
      model: modelName,
      successfulIterations,
      firstIteration,
      latestIteration: modelResult.summary.latestIteration || latestIteration,
      bestIteration,
      firstAvgPct,
      latestAvgPct,
      bestAvgPct: modelResult.summary.bestIteration?.avgPct ?? null,
      netImprovement,
      peakGain,
      improvementRate,
      stopReason: modelResult.summary.stopReason || 'n/a',
      completedIterations: modelResult.summary.successfulIterations || successfulIterations.length,
      modelResult,
    };
  }

  function allComparisonEntries() {
    return state.modelKeys.map(normalizeComparisonEntry);
  }

  function formatPercentDelta(value) {
    if (value == null || Number.isNaN(value)) return 'n/a';
    return `${value > 0 ? '+' : ''}${Math.round(value * 10) / 10}%`;
  }

  function formatPerIteration(value) {
    if (value == null || Number.isNaN(value)) return 'n/a';
    return `${value > 0 ? '+' : ''}${(Math.round(value * 10) / 10).toFixed(1)} pts/iter`;
  }

  function formatStopReason(reason) {
    if (!reason) return 'n/a';
    return reason
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function formatDate(value) {
    if (!value) return 'n/a';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function normalizeLegacyResults(raw) {
    if (raw && raw.models) return raw;
    if (!raw || !raw.model || !Array.isArray(raw.iterations)) return null;

    const successfulIterations = raw.iterations.filter(iter => !iter.error && typeof iter.avgPct === 'number');
    const bestIteration = successfulIterations.reduce((best, iter) => {
      if (!best || iter.avgPct > best.avgPct) return iter;
      return best;
    }, null);
    const latestIteration = successfulIterations[successfulIterations.length - 1] || null;
    const model = raw.model;

    const normalized = {
      generatedAt: raw.generatedAt || null,
      schemaVersion: 1,
      protocol: {
        comparisonMode: 'legacy_single_model',
        gamesPerIter: raw.gamesPerIter || null,
        maxIterations: raw.iterations.length,
        gridSize: raw.gridSize || null,
        nPlayers: raw.nPlayers || null,
      },
      models: {
        [model]: {
          model,
          summary: {
            model,
            iterationsCompleted: raw.iterations.length,
            successfulIterations: successfulIterations.length,
            targetIterations: raw.iterations.length,
            stoppedEarly: false,
            stopReason: 'legacy_output',
            plateauPolicy: null,
            baselineOpponents: [],
            bestIteration: bestIteration ? {
              iter: bestIteration.iter,
              algoName: bestIteration.algoName,
              avgPct: bestIteration.avgPct,
              avgTicks: null,
              rawCode: bestIteration.rawCode,
            } : null,
            latestIteration: latestIteration ? {
              iter: latestIteration.iter,
              algoName: latestIteration.algoName,
              avgPct: latestIteration.avgPct,
              avgTicks: null,
            } : null,
            learningCurve: successfulIterations.map(iter => ({
              iter: iter.iter,
              avgPct: iter.avgPct,
              avgTicks: null,
            })),
            suggestedFollowOn: bestIteration ? {
              type: 'best_vs_best_replay',
              model,
              iter: bestIteration.iter,
              algoName: bestIteration.algoName,
            } : null,
          },
          iterations: raw.iterations.map(iter => ({
            ...iter,
            promptMode: iter.iter === 1 ? 'baseline' : 'iterative',
            promptFeedback: {
              rewardSignals: [],
              leaderboard: [],
              recentHistory: [],
            },
            representativeGame: null,
          })),
        },
      },
      rankings: [{
        model,
        bestAvgPct: bestIteration?.avgPct ?? 0,
        bestIteration: bestIteration?.iter ?? null,
        latestAvgPct: latestIteration?.avgPct ?? 0,
        completedIterations: successfulIterations.length,
        stopReason: 'legacy_output',
      }],
    };

    return normalized;
  }

  async function loadResults() {
    try {
      // Prefer the shared ArenaRegistry loader if available (Phase 9A+).
      // It tries eval-results.json first and falls back to the bundled
      // sample-eval-results.json so fresh clones always have something to show.
      let raw = null;
      if (window.ArenaRegistry && typeof window.ArenaRegistry.load === 'function') {
        await window.ArenaRegistry.load();
        raw = window.ArenaRegistry.getResults();
        if (!raw) {
          throw new Error(window.ArenaRegistry.getLoadError() || 'No eval output found');
        }
      } else {
        const response = await fetch('eval-results.json', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Could not load eval-results.json (${response.status})`);
        }
        raw = await response.json();
      }
      const normalized = normalizeLegacyResults(raw);
      if (!normalized) {
        throw new Error('eval-results.json did not match a supported schema');
      }
      state.results = normalized;
      state.modelKeys = normalized.rankings?.length
        ? normalized.rankings.map(entry => entry.model).filter(model => normalized.models[model])
        : Object.keys(normalized.models);
      if (!state.modelKeys.length) {
        throw new Error('No model runs were found in eval-results.json');
      }
      state.selectedModel = state.modelKeys[0];
      const bestIter = normalized.models[state.selectedModel].summary.bestIteration?.iter;
      state.selectedIteration = bestIter || normalized.models[state.selectedModel].iterations[0]?.iter || 1;
      render();
    } catch (error) {
      emptyState.innerHTML = `
        <strong>Results dashboard is ready, but no benchmark output is available yet.</strong>
        <p style="margin-top:10px; color: var(--text-secondary)">
          ${escapeHtml(error.message)}
        </p>
        <p style="margin-top:10px; color: var(--text-muted)">
          Run <code>npm run eval:quick</code> or <code>npm run eval -- --model claude-sonnet-4-20250514 --model gpt-4o</code>, then reload this page.
        </p>
      `;
    }
  }

  function render() {
    emptyState.style.display = 'none';
    content.style.display = 'block';

    renderVersionBadge();
    // Hero first: chart drawing depends only on model learning curves and
    // (optionally) the reference mean for the dashed anchor.
    renderChart();
    renderLeaderboard();
    renderReferencePanel();
    renderProtocol();
    renderSummary();
    renderVerdicts();
    renderSelectors();
    renderSelectedRun();
    renderFollowOn();
    renderPairwisePanel();
    renderHeadToHeadMatrix();
    renderFailureTaxonomy();
  }

  // Heuristic tiering for the filter strip. Kept as substring tests so it
  // stays readable and survives model-name additions; anything unknown falls
  // through to `frontier` so brand-new models default to the top tier rather
  // than vanish when a user clicks `Cheap`.
  function tierFor(modelName) {
    const m = String(modelName || '').toLowerCase();
    // Specific mid-tier names must win over the generic cheap `mini` substring.
    if (/(gpt-4\.1-mini|gpt-4-turbo|llama-3-70)/.test(m)) return 'mid';
    if (/(haiku|mini|nano|flash|-8b|-7b|-3b)/.test(m)) return 'cheap';
    if (/(sonnet|gpt-4o$)/.test(m)) return 'mid';
    return 'frontier';
  }

  function tierLabel(tier) {
    if (tier === 'cheap') return 'cheap';
    if (tier === 'mid') return 'mid-tier';
    return 'frontier';
  }

  function renderSummary() {
    const rankings = state.results.rankings || [];
    const bestOverall = rankings[0] || null;
    const totalModels = rankings.length;
    const totalIterations = state.modelKeys.reduce((sum, key) => {
      return sum + (state.results.models[key].summary.successfulIterations || 0);
    }, 0);
    const protocol = state.results.protocol || {};
    const protocolLabel = protocol.comparisonMode ? protocol.comparisonMode.replace(/_/g, ' ') : 'n/a';

    summaryGrid.innerHTML = [
      metricCard(bestOverall ? `${bestOverall.model} (${bestOverall.bestAvgPct}%)` : 'n/a', 'Best peak result'),
      metricCard(totalModels, 'Models compared'),
      metricCard(totalIterations, 'Successful eval iterations'),
      metricCard(protocol.maxIterations || 'n/a', 'Target eval iterations'),
      metricCard(protocol.gamesPerIter || 'n/a', 'Games per iteration'),
      metricCard(protocolLabel, 'Comparison mode'),
    ].join('');
  }

  function renderVerdicts() {
    const entries = allComparisonEntries();
    const bestFinisher = [...entries].sort((a, b) => {
      if ((b.bestAvgPct ?? -Infinity) !== (a.bestAvgPct ?? -Infinity)) {
        return (b.bestAvgPct ?? -Infinity) - (a.bestAvgPct ?? -Infinity);
      }
      return (a.bestIteration?.iter ?? Number.MAX_SAFE_INTEGER) - (b.bestIteration?.iter ?? Number.MAX_SAFE_INTEGER);
    })[0];
    const strongestLatest = [...entries].sort((a, b) => (b.latestAvgPct ?? -Infinity) - (a.latestAvgPct ?? -Infinity))[0];
    const fastestImprover = [...entries].sort((a, b) => (b.improvementRate ?? -Infinity) - (a.improvementRate ?? -Infinity))[0];

    verdictGrid.innerHTML = [
      metricCard(
        bestFinisher ? `${bestFinisher.model} (${bestFinisher.bestAvgPct}%)` : 'n/a',
        bestFinisher ? `Best finisher at iter ${bestFinisher.bestIteration?.iter ?? 'n/a'}` : 'Best finisher'
      ),
      metricCard(
        strongestLatest ? `${strongestLatest.model} (${strongestLatest.latestAvgPct}%)` : 'n/a',
        'Strongest latest result'
      ),
      metricCard(
        fastestImprover ? `${fastestImprover.model} (${formatPerIteration(fastestImprover.improvementRate)})` : 'n/a',
        'Fastest improver across the run'
      ),
    ].join('');
  }

  function renderVersionBadge() {
    if (!versionBadge) return;
    const evalVersion = state.results.evalVersion || state.results.protocol?.evalVersion;
    if (!evalVersion) {
      versionBadge.hidden = true;
      return;
    }
    versionBadge.textContent = evalVersion;
    const changelog = Array.isArray(state.results.changelog) ? state.results.changelog : [];
    versionBadge.title = changelog.length
      ? `Changelog:\n${changelog.join('\n')}`
      : `Eval version: ${evalVersion}`;
    versionBadge.hidden = false;
  }

  function renderProtocol() {
    const protocol = state.results.protocol || {};
    const evalVersion = state.results.evalVersion || protocol.evalVersion;
    protocolGrid.innerHTML = [
      metaItem('Run timestamp', formatDate(state.results.generatedAt)),
      metaItem('Eval version', evalVersion ?? 'n/a'),
      metaItem('Eval schema version', state.results.schemaVersion ?? 'n/a'),
      metaItem('Grid size', protocol.gridSize ?? 'n/a'),
      metaItem('Player count', protocol.nPlayers ?? 'n/a'),
      metaItem('Games per iteration', protocol.gamesPerIter ?? 'n/a'),
      metaItem('Target iterations', protocol.maxIterations ?? 'n/a'),
      metaItem('Plateau policy', protocol.plateauPatience == null ? 'n/a' : `${protocol.plateauPatience} rounds, ${protocol.plateauMinImprovement ?? 'n/a'}% min gain`),
      metaItem('Baseline opponents', Array.isArray(protocol.baselineOpponents) && protocol.baselineOpponents.length ? protocol.baselineOpponents.join(', ') : 'n/a'),
    ].join('');
  }

  function renderLeaderboard() {
    if (!filterStrip) return;

    // Wire filter buttons exactly once. Repeated renders just toggle .active.
    if (!filterStrip.dataset.wired) {
      filterStrip.addEventListener('click', (e) => {
        const btn = e.target.closest('button.filter-btn');
        if (!btn) return;
        const next = btn.dataset.filter || 'all';
        if (next === state.filter) return;
        state.filter = next;
        // Collapse all rows on tier change so the table doesn't jump awkwardly.
        state.expandedRows.clear();
        // Re-run the full leaderboard render so button .active / .disabled classes
        // stay in sync with the currently selected tier.
        renderLeaderboard();
      });
      filterStrip.dataset.wired = 'true';
    }

    // Reflect active state on buttons + greyness on empty tiers.
    const entries = allComparisonEntries();
    const tierCounts = { all: entries.length, frontier: 0, mid: 0, cheap: 0 };
    entries.forEach(e => { tierCounts[tierFor(e.model)] = (tierCounts[tierFor(e.model)] || 0) + 1; });
    Array.from(filterStrip.querySelectorAll('button.filter-btn')).forEach(btn => {
      const f = btn.dataset.filter || 'all';
      btn.classList.toggle('active', f === state.filter);
      const c = tierCounts[f] || 0;
      btn.classList.toggle('disabled', c === 0 && f !== 'all');
      btn.setAttribute('title', c + ' model' + (c === 1 ? '' : 's') + ' in this tier');
    });

    renderLeaderboardTable();
  }

  function renderLeaderboardTable() {
    const all = allComparisonEntries();
    const filtered = state.filter === 'all'
      ? all
      : all.filter(e => tierFor(e.model) === state.filter);

    if (filterCount) {
      filterCount.textContent = filtered.length
        ? filtered.length + ' of ' + all.length + ' model' + (all.length === 1 ? '' : 's')
        : '';
    }

    if (!filtered.length) {
      comparisonTableBody.innerHTML = `
        <tr><td colspan="6"><div class="leaderboard-filter-empty">No models in this tier for this run. Select <strong>All</strong> to see every model.</div></td></tr>
      `;
      return;
    }

    const rows = filtered.map((entry, index) => {
      const tier = tierFor(entry.model);
      const replayLink = entry.bestIteration
        ? `<a class="btn-link" href="arena.html?loadModel=${encodeURIComponent(entry.model)}&loadIter=${entry.bestIteration.iter}" target="_blank" rel="noopener noreferrer">Replay Best</a>`
        : '<span style="color:var(--text-muted)">n/a</span>';
      const bestPct = entry.bestAvgPct != null ? entry.bestAvgPct + '%' : 'n/a';
      const bestIter = entry.bestIteration?.iter ?? 'n/a';
      const expanded = state.expandedRows.has(entry.model);
      const toggleLabel = expanded ? '&#9662;' : '&#9656;';
      const expandRow = `
        <tr class="expand-row" data-model-detail="${escapeHtml(entry.model)}" ${expanded ? '' : 'hidden'}>
          <td colspan="6">
            <div class="expand-grid">
              <div><strong>Net improvement</strong><span>${escapeHtml(formatPercentDelta(entry.netImprovement))}</span></div>
              <div><strong>Improvement rate</strong><span>${escapeHtml(formatPerIteration(entry.improvementRate))}</span></div>
              <div><strong>Latest score</strong><span>${entry.latestAvgPct != null ? escapeHtml(entry.latestAvgPct + '%') : 'n/a'}</span></div>
              <div><strong>Successful iterations</strong><span>${escapeHtml(String(entry.completedIterations ?? 'n/a'))}</span></div>
              <div><strong>Stop reason</strong><span>${escapeHtml(formatStopReason(entry.stopReason))}</span></div>
              <div><strong>Tier</strong><span>${escapeHtml(tierLabel(tier))}</span></div>
            </div>
          </td>
        </tr>
      `;
      return `
      <tr data-model-row="${escapeHtml(entry.model)}">
        <td class="rank-cell">${index + 1}</td>
        <td class="model-cell">${escapeHtml(entry.model)}<span class="tier-chip">${escapeHtml(tierLabel(tier))}</span></td>
        <td class="score-cell">${escapeHtml(bestPct)}</td>
        <td>${escapeHtml(String(bestIter))}</td>
        <td>${replayLink}</td>
        <td><button class="expand-toggle" data-model-toggle="${escapeHtml(entry.model)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="Expand row details">${toggleLabel}</button></td>
      </tr>
      ${expandRow}
      `;
    }).join('');

    comparisonTableBody.innerHTML = rows;

    // Wire per-row expand toggles. (Listeners re-bound each render is fine
    // because innerHTML replaces the nodes — no orphan listeners accumulate.)
    Array.from(comparisonTableBody.querySelectorAll('button.expand-toggle')).forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.modelToggle;
        if (!m) return;
        if (state.expandedRows.has(m)) state.expandedRows.delete(m);
        else state.expandedRows.add(m);
        renderLeaderboardTable();
      });
    });
  }

  // Pull the mean reference percentage used to draw the dashed anchor line on
  // the hero learning curve. Returns null if no reference benchmark data is in
  // the current results file (older schemaVersion, or no reference run).
  function referenceMeanPct() {
    const rb = state.results?.referenceBenchmark;
    if (!rb || !Array.isArray(rb.entries) || !rb.entries.length) return null;
    const values = rb.entries
      .map(e => Number(e.referenceMeanPct))
      .filter(v => Number.isFinite(v));
    if (!values.length) return null;
    // Every entry shares the same reference; average just in case they differ.
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function renderChart() {
    const width = 900;
    const height = 320;
    const left = 52;
    const right = 20;
    const top = 18;
    const bottom = 42;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const maxIter = Math.max(1, ...state.modelKeys.map(key => {
      return Math.max(0, ...(state.results.models[key].summary.learningCurve || []).map(point => point.iter));
    }));

    const yForPct = pct => top + chartHeight - ((pct / 100) * chartHeight);
    const xForIter = iter => {
      if (maxIter === 1) return left + chartWidth / 2;
      return left + ((iter - 1) / (maxIter - 1)) * chartWidth;
    };

    // Y-axis grid lines
    const gridLines = [0, 25, 50, 75, 100].map(pct => {
      const y = yForPct(pct);
      const isMajor = pct === 0 || pct === 100;
      return `
        <line class="${isMajor ? 'grid-line-major' : 'grid-line'}" x1="${left}" y1="${y}" x2="${left + chartWidth}" y2="${y}" />
        <text class="axis-label" x="${left - 10}" y="${y + 4}" text-anchor="end">${pct}%</text>
      `;
    }).join('');

    // X-axis ticks
    const xTicks = Array.from({ length: maxIter }, (_, index) => index + 1).map(iter => {
      const x = xForIter(iter);
      return `
        <line class="grid-line" x1="${x}" y1="${top}" x2="${x}" y2="${top + chartHeight}" />
        <text class="axis-label" x="${x}" y="${height - 14}" text-anchor="middle">${iter}</text>
      `;
    }).join('');

    // Axis labels
    const axisLabels = `
      <text class="axis-label" x="${left - 36}" y="${top + chartHeight / 2}" text-anchor="middle" transform="rotate(-90, ${left - 36}, ${top + chartHeight / 2})" style="font-size:12px; fill:var(--text-muted);">Territory %</text>
      <text class="axis-label" x="${left + chartWidth / 2}" y="${height - 2}" text-anchor="middle" style="font-size:12px; fill:var(--text-muted);">Eval Iteration</text>
    `;

    // Build confidence bands and lines
    const modelData = state.modelKeys.map((key, index) => {
      const color = COLORS[index % COLORS.length];
      const learningCurveData = state.results.models[key].summary.learningCurve || [];
      return { key, color, learningCurveData };
    });

    // Confidence bands (rendered before lines so lines sit on top)
    const confidenceBands = modelData.map(({ color, learningCurveData }) => {
      if (!learningCurveData.length || !learningCurveData[0].std) return '';
      const bandPoints = [];
      learningCurveData.forEach(point => {
        const std = point.std || 0;
        bandPoints.push(`${xForIter(point.iter)},${yForPct(Math.min(100, point.avgPct + std))}`);
      });
      for (let i = learningCurveData.length - 1; i >= 0; i--) {
        const point = learningCurveData[i];
        const std = point.std || 0;
        bandPoints.push(`${xForIter(point.iter)},${yForPct(Math.max(0, point.avgPct - std))}`);
      }
      return `<polygon class="confidence-band" points="${bandPoints.join(' ')}" fill="${color}" />`;
    }).join('');

    const lines = modelData.map(({ key, color, learningCurveData }) => {
      if (!learningCurveData.length) return '';

      const points = learningCurveData.map(point => `${xForIter(point.iter)},${yForPct(point.avgPct)}`).join(' ');

      const circles = learningCurveData.map(point => {
        const x = xForIter(point.iter);
        const y = yForPct(point.avgPct);
        const std = point.std || 0;
        return `
          <circle class="chart-point"
            cx="${x}" cy="${y}" r="4" fill="${color}" stroke="none"
            data-model="${escapeHtml(key)}"
            data-iter="${point.iter}"
            data-avg="${point.avgPct}"
            data-std="${std}"
            data-ticks="${point.avgTicks ?? 'n/a'}"
          />
        `;
      }).join('');

      return `
        <polyline class="chart-line" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
        ${circles}
      `;
    }).join('');

    // Optional dashed anchor for the held-out reference (mean across entries).
    const refPct = referenceMeanPct();
    let referenceLine = '';
    let referenceLabel = '';
    if (Number.isFinite(refPct)) {
      const y = yForPct(refPct);
      referenceLine = `<line x1="${left}" y1="${y}" x2="${left + chartWidth}" y2="${y}" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="6 4" />`;
      referenceLabel = `<text x="${left + chartWidth - 6}" y="${y - 6}" text-anchor="end" style="font-size:11px; fill:var(--text-muted);">Reference ${refPct.toFixed(0)}%</text>`;
    }

    learningCurve.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
      ${gridLines}
      ${xTicks}
      ${axisLabels}
      <line x1="${left}" y1="${top + chartHeight}" x2="${left + chartWidth}" y2="${top + chartHeight}" stroke="var(--border-hover)" stroke-width="1.5" />
      <line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartHeight}" stroke="var(--border-hover)" stroke-width="1.5" />
      ${confidenceBands}
      ${referenceLine}
      ${referenceLabel}
      ${lines}
    `;

    const legendReference = Number.isFinite(refPct)
      ? `<div class="legend-item" title="Held-out reference algorithm — frozen, never seen by models">
           <span class="legend-swatch" style="background:transparent; border-top:2px dashed var(--text-muted); border-radius:0; height:0;"></span>
           <span>Held-out reference &middot; ${refPct.toFixed(0)}%</span>
         </div>`
      : '';

    chartLegend.innerHTML = state.results.rankings.map((entry, index) => {
      const color = COLORS[index % COLORS.length];
      const comparison = normalizeComparisonEntry(entry.model);
      return `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${color}"></span>
          <span>${escapeHtml(entry.model)} &middot; best ${escapeHtml(entry.bestAvgPct)}% &middot; net ${escapeHtml(formatPercentDelta(comparison.netImprovement))}</span>
        </div>
      `;
    }).join('') + legendReference;

    attachChartTooltips();
  }

  /* ─── Held-out reference panel ─── */
  function renderReferencePanel() {
    if (!referencePanel || !referenceSummary || !referenceGrid) return;
    const rb = state.results?.referenceBenchmark;
    if (!rb || !Array.isArray(rb.entries) || !rb.entries.length) {
      referencePanel.hidden = true;
      return;
    }
    referencePanel.hidden = false;

    const entries = rb.entries;
    const losers = entries.filter(e => e.verdict === 'reference_better' && e.significant);
    const deltas = entries.map(e => Number(e.meanDelta)).filter(Number.isFinite);
    const medianDelta = deltas.length
      ? (deltas.slice().sort((a, b) => a - b)[Math.floor(deltas.length / 2)])
      : null;

    const winners = entries.filter(e => e.verdict === 'model_better' && e.significant).length;
    const tied = entries.filter(e => !e.significant).length;
    const referenceLabel = rb.referenceName || 'held-out';

    let summary;
    if (losers.length === entries.length && entries.length > 1) {
      summary = `All ${entries.length} models lose to the held-out reference — median Δ = ${formatPercentDelta(medianDelta)}, CI excludes zero for every model.`;
    } else if (losers.length && winners) {
      const parts = [
        `${winners} significantly beat${winners === 1 ? 's' : ''} the reference`,
        `${losers.length} significantly lose${losers.length === 1 ? 's' : ''}`,
      ];
      if (tied) parts.push(`${tied} not distinguishable`);
      summary = `${parts.join(', ')}. Median Δ across all models: ${formatPercentDelta(medianDelta)}. Reference: ${referenceLabel}.`;
    } else if (losers.length) {
      summary = `${losers.length} of ${entries.length} model${entries.length === 1 ? '' : 's'} significantly lose to the reference (CI excludes zero). Median Δ across all models: ${formatPercentDelta(medianDelta)}.`;
    } else if (winners === entries.length && entries.length > 1) {
      summary = `All ${entries.length} models significantly beat the reference — median Δ = ${formatPercentDelta(medianDelta)}, CI excludes zero for every model. Reference: ${referenceLabel}.`;
    } else if (winners && tied) {
      summary = `${winners} model${winners === 1 ? '' : 's'} significantly beat the reference (CI excludes zero); ${tied} not distinguishable (CI overlaps zero). Reference: ${referenceLabel}.`;
    } else if (winners) {
      summary = `${winners} of ${entries.length} model${entries.length === 1 ? '' : 's'} significantly beat the reference (CI excludes zero). Reference: ${referenceLabel}.`;
    } else {
      // `referenceSummary.textContent = summary` escapes automatically; escapeHtml
      // here would cause literal `&amp;` / `&lt;` / `&gt;` to render on screen.
      summary = `${tied} model${tied === 1 ? '' : 's'} not distinguishable from the reference (CI overlaps zero). Reference: ${referenceLabel}.`;
    }
    referenceSummary.textContent = summary;

    referenceGrid.innerHTML = entries.map(e => {
      const delta = Number(e.meanDelta);
      const deltaClass = !Number.isFinite(delta) ? '' : (delta >= 0 ? 'pos' : 'neg');
      const ciLow = Number.isFinite(e.ciLow) ? e.ciLow.toFixed(1) : '?';
      const ciHigh = Number.isFinite(e.ciHigh) ? e.ciHigh.toFixed(1) : '?';
      let verdictText;
      let verdictClass;
      if (e.verdict === 'reference_better' && e.significant) {
        verdictText = 'Loses to the reference (significant)';
        verdictClass = 'loses';
      } else if (e.verdict === 'model_better' && e.significant) {
        verdictText = 'Beats the reference (significant)';
        verdictClass = 'wins';
      } else {
        verdictText = 'Not distinguishable from the reference';
        verdictClass = 'tied';
      }
      return `
        <div class="reference-card">
          <div class="ref-model">${escapeHtml(e.model)} <span style="color:var(--text-muted); font-weight:400; font-size:12px;">&middot; iter ${escapeHtml(String(e.iter))}</span></div>
          <div class="ref-delta ${deltaClass}">${escapeHtml(formatPercentDelta(delta))}</div>
          <div class="ref-ci">95% CI [${ciLow}, ${ciHigh}] &middot; ${escapeHtml(String(e.gamesPlayed ?? 'n/a'))} games &middot; ${escapeHtml(String(e.winsVsReference ?? 0))}W</div>
          <div class="ref-verdict ${verdictClass}">${escapeHtml(verdictText)}</div>
        </div>
      `;
    }).join('');
  }

  function attachChartTooltips() {
    const points = learningCurve.querySelectorAll('.chart-point');
    points.forEach(point => {
      point.addEventListener('mouseenter', (e) => {
        const model = e.target.getAttribute('data-model');
        const iter = e.target.getAttribute('data-iter');
        const avg = e.target.getAttribute('data-avg');
        const std = e.target.getAttribute('data-std');
        const ticks = e.target.getAttribute('data-ticks');

        const stdLine = std && parseFloat(std) > 0 ? `<span>Std dev: &plusmn;${std}%</span>` : '';
        const ticksLine = ticks && ticks !== 'n/a' ? `<span>Avg ticks: ${ticks}</span>` : '';

        chartTooltip.innerHTML = `
          <strong>${escapeHtml(model)}</strong>
          <span>Iter ${iter}: ${avg}% territory</span>
          ${stdLine}
          ${ticksLine}
        `;

        const svgRect = learningCurve.getBoundingClientRect();
        const pointRect = e.target.getBoundingClientRect();
        const containerRect = document.getElementById('chart-container').getBoundingClientRect();

        let left = pointRect.left - containerRect.left + 14;
        let top = pointRect.top - containerRect.top - 8;

        // Clamp tooltip within container
        chartTooltip.style.left = `${left}px`;
        chartTooltip.style.top = `${top}px`;
        chartTooltip.classList.add('visible');
      });

      point.addEventListener('mouseleave', () => {
        chartTooltip.classList.remove('visible');
      });
    });
  }

  function renderSelectors() {
    modelSelect.innerHTML = state.modelKeys.map(key => {
      return `<option value="${escapeHtml(key)}"${key === state.selectedModel ? ' selected' : ''}>${escapeHtml(key)}</option>`;
    }).join('');

    const modelResult = state.results.models[state.selectedModel];
    const successfulIterations = successfulIterationsFor(modelResult);
    iterationSelect.innerHTML = successfulIterations.map(iter => {
      const label = `Eval iter ${iter.iter} · ${iter.avgPct}% · ${iter.algoName}`;
      return `<option value="${iter.iter}"${iter.iter === state.selectedIteration ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');

    modelSelect.onchange = () => {
      state.selectedModel = modelSelect.value;
      const nextModel = state.results.models[state.selectedModel];
      state.selectedIteration = nextModel.summary.bestIteration?.iter || nextModel.iterations.find(iter => !iter.error)?.iter || 1;
      render();
    };

    iterationSelect.onchange = () => {
      state.selectedIteration = parseInt(iterationSelect.value, 10);
      renderSelectedRun();
    };
  }

  function renderSelectedRun() {
    const modelResult = state.results.models[state.selectedModel];
    const comparison = normalizeComparisonEntry(state.selectedModel);
    const selectedIteration = modelResult.iterations.find(iter => iter.iter === state.selectedIteration && !iter.error)
      || modelResult.iterations.find(iter => !iter.error)
      || null;

    const openInArena = document.getElementById('open-in-arena');
    if (openInArena) {
      const iter = selectedIteration ? selectedIteration.iter : state.selectedIteration;
      openInArena.href = `arena.html?loadModel=${encodeURIComponent(state.selectedModel)}&loadIter=${iter}`;
    }

    modelSummary.innerHTML = [
      metaItem('Model', modelResult.model),
      metaItem('Best peak result', modelResult.summary.bestIteration ? `${modelResult.summary.bestIteration.avgPct}% at eval iter ${modelResult.summary.bestIteration.iter}` : 'n/a'),
      metaItem('Latest result', modelResult.summary.latestIteration ? `${modelResult.summary.latestIteration.avgPct}% at eval iter ${modelResult.summary.latestIteration.iter}` : 'n/a'),
      metaItem('Net improvement', formatPercentDelta(comparison.netImprovement)),
      metaItem('Improvement rate', formatPerIteration(comparison.improvementRate)),
      metaItem('Completed eval iterations', modelResult.summary.successfulIterations),
      metaItem('Stop reason', formatStopReason(modelResult.summary.stopReason || 'n/a')),
      metaItem('Baselines', (modelResult.summary.baselineOpponents || []).join(', ') || 'n/a'),
    ].join('');

    if (!selectedIteration) {
      iterationMeta.innerHTML = '';
      rewardSignals.innerHTML = '';
      leaderboardSnapshot.innerHTML = listRow('No successful iterations', 'n/a');
      historySnapshot.innerHTML = '';
      codeViewer.innerHTML = syntaxHighlight('// no generated code available');
      snapshotMeta.innerHTML = '';
      stopMiniArena();
      drawMiniArenaMessage('No iteration selected');
      return;
    }

    iterationMeta.innerHTML = [
      metaItem('Eval iteration', selectedIteration.iter),
      metaItem('Prompt mode', selectedIteration.promptMode || 'n/a'),
      metaItem('Mean territory', `${selectedIteration.avgPct}%`),
      metaItem('Mean ticks', selectedIteration.avgTicks ?? 'n/a'),
      metaItem('Delta vs previous eval iteration', formatPercentDelta(selectedIteration.improvementFromLastIter)),
      metaItem('Delta vs same-model best before this iteration', formatPercentDelta(selectedIteration.improvementFromBestBeforeIter)),
    ].join('');

    rewardSignals.innerHTML = (selectedIteration.promptFeedback?.rewardSignals || []).length
      ? selectedIteration.promptFeedback.rewardSignals.map(signal => `<span class="chip">${escapeHtml(signal)}</span>`).join('')
      : '<span class="chip">First eval round: no prior feedback signals yet</span>';

    const leaderboard = selectedIteration.promptFeedback?.leaderboard || [];
    leaderboardSnapshot.innerHTML = leaderboard.length
      ? leaderboard.map(entry => listRow(`${entry.name}`, `${entry.avgPct}% over ${entry.runs} runs`)).join('')
      : listRow('No same-model leaderboard yet', selectedIteration.promptMode === 'baseline' ? 'baseline eval round' : 'n/a');

    const history = selectedIteration.promptFeedback?.recentHistory || [];
    historySnapshot.innerHTML = history.length
      ? history.map(entry => listRow(`Eval iter ${entry.iter}: ${entry.algoName}`, `${entry.avgPct}% in ${entry.ticks} ticks`)).join('')
      : listRow('No same-model history yet', selectedIteration.promptMode === 'baseline' ? 'baseline eval round' : 'n/a');

    codeViewer.innerHTML = syntaxHighlight(selectedIteration.rawCode || '// no generated code captured');

    // Populate the meta list with iteration-evidence (score, ticks) so the
    // mini arena has numbers alongside it. The static "representative game"
    // grid is gone; the live replay below now plays the model's actual code.
    const rep = selectedIteration.representativeGame;
    const metaRows = [
      metaItem('Iteration mean', `${selectedIteration.avgPct}% territory`),
      metaItem('Iteration mean ticks', selectedIteration.avgTicks ?? 'n/a'),
    ];
    if (rep) {
      metaRows.push(metaItem('Representative game', `${rep.pct}% in ${rep.ticks} ticks`));
    }
    snapshotMeta.innerHTML = metaRows.join('');

    // (Re)start the inline mini arena for this iteration.
    startMiniArenaForIteration(state.selectedModel, selectedIteration);
  }

  function renderFollowOn() {
    const rankings = state.results.rankings || [];
    if (rankings.length < 2) {
      followOn.innerHTML = listRow('Need at least two model runs', 'for best-vs-best replay');
      return;
    }

    const topTwo = rankings.slice(0, 2);
    followOn.innerHTML = topTwo.map((entry, index) => {
      const modelResult = state.results.models[entry.model];
      const best = modelResult.summary.bestIteration;
      return listRow(
        `${index + 1}. ${entry.model}`,
        best ? `replay iter ${best.iter} (${best.avgPct}%) next` : 'n/a'
      );
    }).join('');
  }

  /* ─── Pairwise Comparisons panel ─── */
  // Formats a pair card for state.results.pairwiseComparisons[i]. Reuses the
  // verdict triage the runner already emitted (a_better / b_better / tied).
  function renderPairwisePanel() {
    if (!pairwisePanel || !pairwiseGrid) return;
    const pairs = Array.isArray(state.results?.pairwiseComparisons)
      ? state.results.pairwiseComparisons
      : [];
    if (!pairs.length) { pairwisePanel.hidden = true; return; }
    pairwisePanel.hidden = false;
    pairwiseGrid.innerHTML = pairs.map(p => {
      const delta = Number(p.meanDelta);
      const deltaClass = !Number.isFinite(delta) ? 'zero' : (delta > 0 ? 'pos' : (delta < 0 ? 'neg' : 'zero'));
      const ciLow = Number.isFinite(p.ciLow) ? p.ciLow.toFixed(1) : '?';
      const ciHigh = Number.isFinite(p.ciHigh) ? p.ciHigh.toFixed(1) : '?';
      let verdictText; let verdictClass;
      if (p.verdict === 'a_better') { verdictText = `${p.modelA} better (CI excludes zero)`; verdictClass = 'a-better'; }
      else if (p.verdict === 'b_better') { verdictText = `${p.modelB} better (CI excludes zero)`; verdictClass = 'b-better'; }
      else { verdictText = 'Not distinguishable (CI overlaps zero)'; verdictClass = 'tied'; }
      return `
        <div class="pairwise-card">
          <div class="pw-pair">${escapeHtml(p.modelA)} · iter ${escapeHtml(String(p.iterA))} <span style="color:var(--text-muted); font-weight:400;">vs</span> ${escapeHtml(p.modelB)} · iter ${escapeHtml(String(p.iterB))}</div>
          <div class="pw-delta ${deltaClass}">${escapeHtml(formatPercentDelta(delta))}</div>
          <div class="pw-ci">95% CI [${ciLow}, ${ciHigh}] · n=${escapeHtml(String(p.nA ?? '?'))}/${escapeHtml(String(p.nB ?? '?'))} · bootstrap ${escapeHtml(String(p.bootstrapIterations ?? 4000))}</div>
          <div class="pw-verdict ${verdictClass}">${escapeHtml(verdictText)}</div>
        </div>
      `;
    }).join('');
  }

  /* ─── Head-to-Head Matrix ─── */
  // Consumes state.results.headToHead.pairs (which the runner emits per
  // Phase 8B, one entry per unordered {A,B} pair). Cells are oriented row-vs-col:
  // when the stored pair's modelA matches the cell's colModel we flip wins/delta.
  function renderHeadToHeadMatrix() {
    const rankings = state.results.rankings || [];
    if (rankings.length < 2) {
      headToHeadMatrix.innerHTML = `<div class="placeholder-cell">At least two model runs required for head-to-head matrix</div>`;
      return;
    }
    const models = rankings.map(r => r.model);
    const pairs = Array.isArray(state.results?.headToHead?.pairs) ? state.results.headToHead.pairs : [];
    const cellHTML = models.map(rowModel => models.map(colModel => {
      if (rowModel === colModel) return `<div class="h2h-cell diag">—</div>`;
      const pair = pairs.find(p =>
        (p.modelA === rowModel && p.modelB === colModel) ||
        (p.modelA === colModel && p.modelB === rowModel));
      if (!pair) return `<div class="h2h-cell"><div style="color:var(--text-muted); font-size:11px;">no data</div></div>`;
      const flip = pair.modelA === colModel;
      const rowWins = flip ? pair.winsB : pair.winsA;
      const colWins = flip ? pair.winsA : pair.winsB;
      const delta = (flip ? -1 : 1) * Number(pair.meanDelta);
      const ciLow = (flip ? -1 : 1) * Number(pair.ciHigh);
      const ciHigh = (flip ? -1 : 1) * Number(pair.ciLow);
      const lo = Math.min(ciLow, ciHigh), hi = Math.max(ciLow, ciHigh);
      const scoreClass = !Number.isFinite(delta) ? 'tied' : (pair.significant ? (delta > 0 ? 'pos' : 'neg') : 'tied');
      const drawsSegment = pair.draws > 0 ? ` <span style="color:var(--text-muted); font-size:11px;">(${escapeHtml(String(pair.draws))} draw${pair.draws === 1 ? '' : 's'})</span>` : '';
      return `
        <div class="h2h-cell">
          <div class="h2h-score ${scoreClass}">${escapeHtml(String(rowWins))}–${escapeHtml(String(colWins))}${drawsSegment}</div>
          <div class="h2h-meta">Δ ${escapeHtml(formatPercentDelta(delta))} · CI [${lo.toFixed(1)}, ${hi.toFixed(1)}]</div>
        </div>`;
    }).join('')).join('');

    headToHeadMatrix.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(${models.length}, minmax(150px, 1fr)); gap:10px; overflow-x:auto;">
        ${cellHTML}
      </div>`;
  }

  /* ─── Failure Taxonomy ─── */
  const FAILURE_FLAG_ORDER = [
    'SYNTAX_ERROR',
    'RUNTIME_CRASH',
    'EXPLOIT_DETECTED',
    'TIMEOUT',
    'REGRESSION_VS_PRIOR',
    'REGRESSION_VS_BEST',
    'STALE',
  ];

  const FAILURE_FLAG_META = {
    SYNTAX_ERROR:        { label: 'Syntax error',       plural: 'syntax errors',        color: '#E85F5F', blurb: 'extraction failed' },
    RUNTIME_CRASH:       { label: 'Runtime crash',      plural: 'runtime crashes',      color: '#E88C40', blurb: 'algorithm threw during play' },
    EXPLOIT_DETECTED:    { label: 'Exploit attempt',    plural: 'exploit attempts',     color: '#B03A3A', blurb: 'claimed a cell outside the valid mask' },
    TIMEOUT:             { label: 'Timeout',            plural: 'timeouts',             color: '#A876E8', blurb: 'exceeded the per-tick budget' },
    REGRESSION_VS_PRIOR: { label: 'Regression (prior)', plural: 'regressions (prior)',  color: '#E8C842', blurb: 'scored below its previous iteration' },
    REGRESSION_VS_BEST:  { label: 'Regression (best)',  plural: 'regressions (best)',   color: '#E8A842', blurb: "scored below its own best" },
    STALE:               { label: 'Plateau / stale',    plural: 'plateau stalls',       color: '#7A7A7A', blurb: 'no meaningful gain for consecutive iterations' },
  };

  function collectFailureCounts(modelResult) {
    const counts = Object.create(null);
    for (const iter of modelResult.iterations) {
      const flags = Array.isArray(iter.failureFlags) ? iter.failureFlags : [];
      for (const flag of flags) {
        counts[flag] = (counts[flag] || 0) + 1;
      }
    }
    return counts;
  }

  function buildFailureSummarySentence(modelName, counts, totalIterations) {
    const parts = [];
    for (const flag of FAILURE_FLAG_ORDER) {
      const n = counts[flag] || 0;
      if (!n) continue;
      const meta = FAILURE_FLAG_META[flag];
      const noun = n === 1 ? meta.label.toLowerCase() : meta.plural;
      parts.push(`${n} ${noun} (${meta.blurb})`);
    }
    if (parts.length === 0) {
      return `${modelName} ran ${totalIterations} iteration${totalIterations === 1 ? '' : 's'} with no annotated failures — stable across the run.`;
    }
    const joined = parts.length === 1
      ? parts[0]
      : parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    return `${modelName} had ${joined} across ${totalIterations} iteration${totalIterations === 1 ? '' : 's'}.`;
  }

  function renderFailureTaxonomy() {
    if (!failureTaxonomy) return;
    const entries = allComparisonEntries();

    if (entries.length === 0) {
      failureTaxonomy.innerHTML = `<div class="failure-empty">No model runs in this result set.</div>`;
      return;
    }

    // Detect whether the runner that produced this file emitted failureFlags at all.
    const anyAnnotated = entries.some(entry =>
      entry.modelResult.iterations.some(iter => Array.isArray(iter.failureFlags))
    );
    if (!anyAnnotated) {
      failureTaxonomy.innerHTML = `<div class="failure-empty">This run was produced by an older eval version without failure annotations. Re-run with the current eval-runner to populate this panel.</div>`;
      return;
    }

    // Find the max count across all (model, flag) pairs so bar widths are comparable.
    let globalMax = 0;
    const perModel = entries.map(entry => {
      const counts = collectFailureCounts(entry.modelResult);
      for (const flag of FAILURE_FLAG_ORDER) {
        if ((counts[flag] || 0) > globalMax) globalMax = counts[flag];
      }
      return { entry, counts };
    });
    if (globalMax === 0) globalMax = 1; // avoid div-by-zero when no failures

    const cards = perModel.map(({ entry, counts }) => {
      const totalIterations = entry.modelResult.iterations.length;
      const rows = FAILURE_FLAG_ORDER.map(flag => {
        const n = counts[flag] || 0;
        const meta = FAILURE_FLAG_META[flag];
        const widthPct = (n / globalMax) * 100;
        return `
          <div class="failure-bar-row">
            <span title="${escapeHtml(meta.blurb)}">${escapeHtml(meta.label)}</span>
            <div class="failure-bar-track">
              <div class="failure-bar-fill" style="width:${widthPct}%; background:${meta.color};"></div>
            </div>
            <span class="failure-bar-count">${n}</span>
          </div>
        `;
      }).join('');
      const summary = buildFailureSummarySentence(entry.model, counts, totalIterations);
      return `
        <div class="failure-card">
          <div class="failure-card-title">${escapeHtml(entry.model)}</div>
          ${rows}
          <div class="failure-summary">${escapeHtml(summary)}</div>
        </div>
      `;
    }).join('');

    failureTaxonomy.innerHTML = cards;
  }

  /* ─── Simple DOM-based syntax highlighting ─── */
  function syntaxHighlight(code) {
    if (!code) return '<span class="token-comment">// no generated code available</span>';

    // Step 1: Protect strings and comments with placeholders so they survive escaping
    const placeholders = [];
    const save = (str) => { placeholders.push(str); return `__PH${placeholders.length - 1}__`; };

    let html = code
      .replace(/(\/\*[\s\S]*?\*\/)/g, save)
      .replace(/(\/\/.*$)/gm, save)
      .replace(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g, save);

    // Step 2: Escape remaining HTML
    html = escapeHtml(html);

    // Step 3: Highlight numbers, keywords, and function names
    html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-number">$1</span>');
    const keywords = [
      'function', 'return', 'if', 'else', 'for', 'while', 'const', 'let', 'var',
      'true', 'false', 'null', 'undefined', 'new', 'this', 'class', 'extends',
      'try', 'catch', 'throw', 'async', 'await', 'import', 'export', 'default',
      'switch', 'case', 'break', 'continue', 'in', 'of', 'typeof', 'instanceof',
    ];
    const keywordPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
    html = html.replace(keywordPattern, '<span class="token-keyword">$1</span>');
    html = html.replace(/\bfunction\s+(\w+)\b/g, 'function <span class="token-function">$1</span>');
    html = html.replace(/\b(\w+)\s*\(/g, '<span class="token-function">$1</span>(');

    // Step 4: Restore placeholders wrapped in syntax spans
    placeholders.forEach((ph, i) => {
      const cls = ph.startsWith('//') || ph.startsWith('/*') ? 'token-comment' : 'token-string';
      html = html.replace(`__PH${i}__`, `<span class="${cls}">${escapeHtml(ph)}</span>`);
    });

    return html;
  }

  /* ─── Inline mini arena (looped replay of model code) ─── */

  // The mini arena runs a real ArenaEngine game with the selected iteration's
  // algorithm in seat 0 and shared baselines in seats 1..n. It auto-loops: when
  // a game finishes we hold for ~1s then restart with fresh seats. Pause/resume
  // is wired to the Pause button in the controls.

  const MINI_GRID_SIZE = 40;
  const MINI_PLAYERS = 4;
  const MINI_TICK_MS = 45;
  const MINI_HOLD_MS = 900;

  function pickMiniBaselines() {
    // Prefer the registry's baselines (same source the arena page uses). Fall
    // back to the global ALGOS array if the registry hasn't loaded.
    let fns = [];
    if (window.ArenaRegistry && typeof window.ArenaRegistry.getBaselines === 'function') {
      fns = window.ArenaRegistry.getBaselines()
        .slice(0, MINI_PLAYERS - 1)
        .map(b => b.fn)
        .filter(fn => typeof fn === 'function');
    }
    if (fns.length < MINI_PLAYERS - 1 && typeof ALGOS !== 'undefined' && Array.isArray(ALGOS)) {
      fns = ALGOS.slice(0, MINI_PLAYERS - 1);
    }
    return fns;
  }

  function drawMiniBoard() {
    if (!miniArenaCanvas) return;
    const ctx = miniArenaCanvas.getContext('2d');
    const canvasSize = miniArenaCanvas.width;
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    ctx.fillStyle = isDark ? '#1e1e1e' : '#f7f7f7';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    if (!miniArena.engine) {
      ctx.fillStyle = isDark ? '#888' : '#555';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(miniArena.error || 'Loading…', canvasSize / 2, canvasSize / 2);
      return;
    }

    const grid = miniArena.engine.grid;
    const size = grid.length;
    const px = canvasSize / size;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const cell = grid[row][col];
        if (cell === null) continue;
        if (cell === -1) {
          ctx.fillStyle = isDark ? 'rgba(120, 120, 120, 0.18)' : 'rgba(120, 120, 120, 0.12)';
        } else {
          ctx.fillStyle = COLORS[cell % COLORS.length];
        }
        ctx.fillRect(col * px, row * px, px, px);
      }
    }
  }

  function drawMiniArenaMessage(message) {
    if (!miniArenaCanvas) return;
    miniArena.engine = null;
    miniArena.error = message;
    drawMiniBoard();
    if (miniArenaTick) miniArenaTick.textContent = '';
    if (miniArenaLegend) miniArenaLegend.innerHTML = '';
  }

  function stopMiniArena() {
    if (miniArena.loopId) {
      clearTimeout(miniArena.loopId);
      miniArena.loopId = null;
    }
  }

  function startMiniArenaForIteration(modelName, iter) {
    if (!miniArenaCanvas) return;
    stopMiniArena();

    const entryId = modelName + '@' + iter.iter;
    miniArena.entryId = entryId;
    miniArena.paused = false;
    miniArena.error = null;
    if (miniArenaToggle) miniArenaToggle.textContent = 'Pause';
    if (miniArenaOpen) {
      miniArenaOpen.href = `arena.html?loadModel=${encodeURIComponent(modelName)}&loadIter=${iter.iter}`;
    }

    // Compile the model's code via the registry. Fall back to a clear error on
    // failure — don't pretend a baseline is the model's code.
    let modelFn = null;
    try {
      if (window.ArenaRegistry && typeof window.ArenaRegistry.findEntry === 'function') {
        const entry = window.ArenaRegistry.findEntry(entryId);
        if (entry) {
          modelFn = window.ArenaRegistry.compile(entry);
        }
      }
    } catch (err) {
      console.warn('[mini-arena] compile failed for', entryId, err);
      drawMiniArenaMessage('Could not compile model code');
      return;
    }
    if (typeof modelFn !== 'function') {
      drawMiniArenaMessage('No compiled algorithm available');
      return;
    }

    const baselines = pickMiniBaselines();
    if (baselines.length < MINI_PLAYERS - 1) {
      drawMiniArenaMessage('Not enough baselines to populate opponents');
      return;
    }

    if (typeof ArenaEngine === 'undefined') {
      drawMiniArenaMessage('engine.js not loaded');
      return;
    }

    const algos = [modelFn, ...baselines.slice(0, MINI_PLAYERS - 1)];
    miniArena.engine = new ArenaEngine(MINI_GRID_SIZE, MINI_PLAYERS, algos);
    miniArena.tick = 0;

    // Legend: model in seat 0, baselines in 1..n.
    const baselineNames = (window.ArenaRegistry?.getBaselines?.() || []).slice(0, MINI_PLAYERS - 1).map(b => b.displayName || b.name);
    const legendItems = [`<span><span class="swatch" style="background:${COLORS[0]}"></span>seat 0: ${escapeHtml(modelName)} iter ${escapeHtml(String(iter.iter))}</span>`];
    baselineNames.forEach((n, i) => {
      legendItems.push(`<span><span class="swatch" style="background:${COLORS[(i + 1) % COLORS.length]}"></span>seat ${i + 1}: ${escapeHtml(n)}</span>`);
    });
    if (miniArenaLegend) miniArenaLegend.innerHTML = legendItems.join('');

    drawMiniBoard();
    if (miniArenaTick) miniArenaTick.textContent = 'tick 0';
    scheduleMiniTick();
  }

  function scheduleMiniTick() {
    miniArena.loopId = setTimeout(() => {
      if (miniArena.paused || !miniArena.engine) return;
      let result;
      try {
        result = miniArena.engine.step();
      } catch (err) {
        console.warn('[mini-arena] step failed:', err);
        drawMiniArenaMessage('Algorithm threw during play');
        return;
      }
      miniArena.tick = miniArena.engine.tick;
      drawMiniBoard();
      if (miniArenaTick) miniArenaTick.textContent = `tick ${miniArena.tick}`;

      if (result && result.done) {
        // Hold the completed board for a moment, then restart with a fresh
        // engine so the replay auto-loops without user input.
        miniArena.loopId = setTimeout(() => {
          if (miniArena.paused) return;
          if (miniArena.engine && miniArena.engine.algos) {
            miniArena.engine = new ArenaEngine(MINI_GRID_SIZE, MINI_PLAYERS, miniArena.engine.algos);
            miniArena.tick = 0;
            drawMiniBoard();
            if (miniArenaTick) miniArenaTick.textContent = 'tick 0';
            scheduleMiniTick();
          }
        }, MINI_HOLD_MS);
        return;
      }
      scheduleMiniTick();
    }, MINI_TICK_MS);
  }

  if (miniArenaToggle) {
    miniArenaToggle.addEventListener('click', () => {
      miniArena.paused = !miniArena.paused;
      miniArenaToggle.textContent = miniArena.paused ? 'Play' : 'Pause';
      if (!miniArena.paused) {
        // Clear any pending timeout before scheduling a fresh tick so rapid
        // pause/unpause cycles cannot fork the loop into parallel chains.
        stopMiniArena();
        scheduleMiniTick();
      }
    });
  }

  /* ─── Theme Toggle ─── */
  function initTheme() {
    const saved = localStorage.getItem('arena-war-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial = saved || (prefersDark ? 'dark' : 'light');
    setTheme(initial);

    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('arena-war-theme', theme);
    if (themeIcon) themeIcon.textContent = theme === 'dark' ? '\u2600' : '\u263E';
    if (themeLabel) themeLabel.textContent = theme === 'dark' ? 'Light' : 'Dark';
    // Redraw the mini arena since its background color depends on theme.
    if (state.results && miniArena.engine) {
      drawMiniBoard();
    }
  }

  // Initialize
  initTheme();
  loadResults();
})();
