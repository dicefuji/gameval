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
  const snapshotCanvas = document.getElementById('snapshot-canvas');
  const snapshotMeta = document.getElementById('snapshot-meta');
  const followOn = document.getElementById('follow-on');
  const headToHeadMatrix = document.getElementById('head-to-head-matrix');
  const failureTaxonomy = document.getElementById('failure-taxonomy');
  const versionBadge = document.getElementById('version-badge');
  const chartTooltip = document.getElementById('chart-tooltip');
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const themeLabel = document.getElementById('theme-label');

  const state = {
    results: null,
    modelKeys: [],
    selectedModel: null,
    selectedIteration: null,
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
      const response = await fetch('eval-results.json', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Could not load eval-results.json (${response.status})`);
      }
      const raw = await response.json();
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
    renderSummary();
    renderVerdicts();
    renderProtocol();
    renderComparisonTable();
    renderChart();
    renderSelectors();
    renderSelectedRun();
    renderFollowOn();
    renderHeadToHeadMatrix();
    renderFailureTaxonomy();
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

  function renderComparisonTable() {
    const entries = allComparisonEntries();
    comparisonTableBody.innerHTML = entries.map((entry, index) => {
      const replayLink = entry.bestIteration
        ? `<a class="btn-link" href="arena.html?loadModel=${encodeURIComponent(entry.model)}&loadIter=${entry.bestIteration.iter}" target="_blank" rel="noopener noreferrer">Replay Best</a>`
        : 'n/a';
      return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(entry.model)}</td>
        <td>${escapeHtml(entry.bestAvgPct == null ? 'n/a' : `${entry.bestAvgPct}%`)}</td>
        <td>${escapeHtml(entry.bestIteration?.iter ?? 'n/a')}</td>
        <td>${escapeHtml(entry.latestAvgPct == null ? 'n/a' : `${entry.latestAvgPct}%`)}</td>
        <td>${escapeHtml(formatPercentDelta(entry.netImprovement))}</td>
        <td>${escapeHtml(entry.completedIterations)}</td>
        <td>${escapeHtml(formatStopReason(entry.stopReason))}</td>
        <td>${replayLink}</td>
      </tr>
    `;
    }).join('');
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

    learningCurve.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
      ${gridLines}
      ${xTicks}
      ${axisLabels}
      <line x1="${left}" y1="${top + chartHeight}" x2="${left + chartWidth}" y2="${top + chartHeight}" stroke="var(--border-hover)" stroke-width="1.5" />
      <line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartHeight}" stroke="var(--border-hover)" stroke-width="1.5" />
      ${confidenceBands}
      ${lines}
    `;

    chartLegend.innerHTML = state.results.rankings.map((entry, index) => {
      const color = COLORS[index % COLORS.length];
      const comparison = normalizeComparisonEntry(entry.model);
      return `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${color}"></span>
          <span>${escapeHtml(entry.model)} &middot; best ${escapeHtml(entry.bestAvgPct)}% &middot; net ${escapeHtml(formatPercentDelta(comparison.netImprovement))}</span>
        </div>
      `;
    }).join('');

    attachChartTooltips();
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
      drawGrid(null);
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

    if (selectedIteration.representativeGame && selectedIteration.representativeGame.finalGrid) {
      snapshotMeta.innerHTML = [
        metaItem('Representative game', `#${selectedIteration.representativeGame.gameNumber}`),
        metaItem('Territory', `${selectedIteration.representativeGame.pct}%`),
        metaItem('Ticks', selectedIteration.representativeGame.ticks),
        metaItem('Winning player slot', `Player ${selectedIteration.representativeGame.winnerIndex + 1}`),
      ].join('');
      drawGrid(selectedIteration.representativeGame.finalGrid);
    } else {
      snapshotMeta.innerHTML = metaItem('Snapshot evidence', 'Not available in this result file');
      drawGrid(null);
    }
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

  /* ─── Head-to-Head Matrix placeholder ─── */
  function renderHeadToHeadMatrix() {
    const rankings = state.results.rankings || [];
    if (rankings.length < 2) {
      headToHeadMatrix.innerHTML = `
        <div class="placeholder-cell">At least two model runs required for head-to-head matrix</div>
      `;
      return;
    }

    // TODO: Replace with actual head-to-head win-rate data when available in eval-results.json
    const models = rankings.map(r => r.model);
    const matrixHTML = models.map((rowModel, rowIdx) => {
      const cells = models.map((colModel, colIdx) => {
        if (rowIdx === colIdx) {
          return `<div class="placeholder-cell" style="background:var(--bg-chip); font-weight:600;">—</div>`;
        }
        // Placeholder: would show win % of rowModel vs colModel
        return `<div class="placeholder-cell">${escapeHtml(rowModel)} vs ${escapeHtml(colModel)}<br><span style="font-size:11px; color:var(--text-muted)">pending replay data</span></div>`;
      }).join('');
      return `<div style="display:contents">${cells}</div>`;
    }).join('');

    headToHeadMatrix.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(${models.length}, minmax(140px, 1fr)); gap:10px; overflow-x:auto;">
        ${matrixHTML}
      </div>
    `;
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

  function drawGrid(grid) {
    const ctx = snapshotCanvas.getContext('2d');
    const canvasSize = snapshotCanvas.width;

    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Dark-mode-aware background
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    ctx.fillStyle = isDark ? '#1e1e1e' : '#f7f7f7';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    if (!grid || !grid.length) {
      ctx.fillStyle = isDark ? '#888' : '#555';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No board snapshot available', canvasSize / 2, canvasSize / 2);
      return;
    }

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

  /* ─── Theme Toggle ─── */
  function initTheme() {
    const saved = localStorage.getItem('arena-war-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    // Default is now the warm light theme. Only fall back to dark when the OS asks for it.
    const initial = saved || (prefersDark ? 'dark' : 'light');
    setTheme(initial);

    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('arena-war-theme', theme);
    // Icon/label describe the action on click (opposite of the current theme).
    if (themeIcon) themeIcon.textContent = theme === 'dark' ? '\u2600' : '\u263E';
    if (themeLabel) themeLabel.textContent = theme === 'dark' ? 'Light' : 'Dark';
    // Redraw canvas if needed since background color depends on theme
    if (state.results) {
      const modelResult = state.results.models[state.selectedModel];
      const selectedIteration = modelResult?.iterations.find(iter => iter.iter === state.selectedIteration && !iter.error)
        || modelResult?.iterations.find(iter => !iter.error)
        || null;
      if (selectedIteration?.representativeGame?.finalGrid) {
        drawGrid(selectedIteration.representativeGame.finalGrid);
      } else {
        drawGrid(null);
      }
    }
  }

  /* ─── Page TOC (sticky left sidebar) ─── */
  function buildPageToc() {
    const nav = document.getElementById('page-toc');
    const linkHost = document.getElementById('page-toc-links');
    if (!nav || !linkHost) return;

    const sections = Array.from(document.querySelectorAll('section[data-toc][id]'))
      .filter(sec => sec.offsetParent !== null);
    if (sections.length === 0) {
      nav.hidden = true;
      return;
    }

    linkHost.innerHTML = sections
      .map(sec => `<a href="#${sec.id}" data-target="${sec.id}">${escapeHtml(sec.dataset.toc)}</a>`)
      .join('');
    nav.hidden = false;

    const anchors = Array.from(linkHost.querySelectorAll('a'));
    const byId = new Map(anchors.map(a => [a.dataset.target, a]));

    if (typeof IntersectionObserver !== 'function') return;

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top)[0];
        if (!visible) return;
        anchors.forEach(a => a.classList.remove('active'));
        const active = byId.get(visible.target.id);
        if (active) active.classList.add('active');
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );

    sections.forEach(sec => observer.observe(sec));
  }

  // Initialize
  initTheme();
  loadResults().then(buildPageToc).catch(() => {});
})();
