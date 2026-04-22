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
      <div class="panel" style="padding:12px">
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
        <p style="margin-top:8px">
          ${escapeHtml(error.message)}
        </p>
        <p style="margin-top:8px">
          Run <code>npm run eval:quick</code> or <code>npm run eval -- --model claude-sonnet-4-20250514 --model gpt-4o</code>, then reload this page.
        </p>
      `;
    }
  }

  function render() {
    emptyState.style.display = 'none';
    content.style.display = 'block';

    renderSummary();
    renderChart();
    renderSelectors();
    renderSelectedRun();
    renderFollowOn();
  }

  function renderSummary() {
    const rankings = state.results.rankings || [];
    const bestOverall = rankings[0] || null;
    const totalModels = rankings.length;
    const totalIterations = state.modelKeys.reduce((sum, key) => {
      return sum + (state.results.models[key].summary.successfulIterations || 0);
    }, 0);
    const protocol = state.results.protocol || {};

    summaryGrid.innerHTML = [
      metricCard(bestOverall ? `${bestOverall.model} (${bestOverall.bestAvgPct}%)` : 'n/a', 'Best overall result'),
      metricCard(totalModels, 'Models compared'),
      metricCard(totalIterations, 'Successful eval iterations'),
      metricCard(protocol.maxIterations || 'n/a', 'Target iterations per model'),
      metricCard(protocol.gamesPerIter || 'n/a', 'Games per iteration'),
      metricCard(protocol.plateauPatience || 'n/a', 'Plateau patience'),
    ].join('');
  }

  function renderChart() {
    const width = 900;
    const height = 300;
    const left = 48;
    const right = 20;
    const top = 18;
    const bottom = 38;
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

    const gridLines = [0, 25, 50, 75, 100].map(pct => {
      const y = yForPct(pct);
      return `
        <line x1="${left}" y1="${y}" x2="${left + chartWidth}" y2="${y}" stroke="#e7e7e7" stroke-width="1" />
        <text x="${left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#888">${pct}%</text>
      `;
    }).join('');

    const xTicks = Array.from({ length: maxIter }, (_, index) => index + 1).map(iter => {
      const x = xForIter(iter);
      return `
        <line x1="${x}" y1="${top}" x2="${x}" y2="${top + chartHeight}" stroke="#f0f0f0" stroke-width="1" />
        <text x="${x}" y="${height - 12}" text-anchor="middle" font-size="11" fill="#888">${iter}</text>
      `;
    }).join('');

    const lines = state.modelKeys.map((key, index) => {
      const color = COLORS[index % COLORS.length];
      const learningCurve = state.results.models[key].summary.learningCurve || [];
      if (!learningCurve.length) return '';

      const points = learningCurve.map(point => `${xForIter(point.iter)},${yForPct(point.avgPct)}`).join(' ');
      const circles = learningCurve.map(point => {
        const x = xForIter(point.iter);
        const y = yForPct(point.avgPct);
        return `<circle cx="${x}" cy="${y}" r="4" fill="${color}" />`;
      }).join('');

      return `
        <polyline fill="none" stroke="${color}" stroke-width="3" points="${points}" />
        ${circles}
      `;
    }).join('');

    learningCurve.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
      ${gridLines}
      ${xTicks}
      <line x1="${left}" y1="${top + chartHeight}" x2="${left + chartWidth}" y2="${top + chartHeight}" stroke="#cfcfcf" stroke-width="1" />
      <line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartHeight}" stroke="#cfcfcf" stroke-width="1" />
      ${lines}
    `;

    chartLegend.innerHTML = state.results.rankings.map((entry, index) => {
      const color = COLORS[index % COLORS.length];
      return `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${color}"></span>
          <span>${escapeHtml(entry.model)} · best ${escapeHtml(entry.bestAvgPct)}%</span>
        </div>
      `;
    }).join('');
  }

  function renderSelectors() {
    modelSelect.innerHTML = state.modelKeys.map(key => {
      return `<option value="${escapeHtml(key)}"${key === state.selectedModel ? ' selected' : ''}>${escapeHtml(key)}</option>`;
    }).join('');

    const modelResult = state.results.models[state.selectedModel];
    const successfulIterations = modelResult.iterations.filter(iter => !iter.error);
    iterationSelect.innerHTML = successfulIterations.map(iter => {
      const label = `Iter ${iter.iter} · ${iter.avgPct}% · ${iter.algoName}`;
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
    const selectedIteration = modelResult.iterations.find(iter => iter.iter === state.selectedIteration && !iter.error)
      || modelResult.iterations.find(iter => !iter.error)
      || null;

    modelSummary.innerHTML = [
      metaItem('Model', modelResult.model),
      metaItem('Best result', modelResult.summary.bestIteration ? `${modelResult.summary.bestIteration.avgPct}% at iter ${modelResult.summary.bestIteration.iter}` : 'n/a'),
      metaItem('Latest result', modelResult.summary.latestIteration ? `${modelResult.summary.latestIteration.avgPct}% at iter ${modelResult.summary.latestIteration.iter}` : 'n/a'),
      metaItem('Completed iterations', modelResult.summary.successfulIterations),
      metaItem('Stop reason', modelResult.summary.stopReason || 'n/a'),
      metaItem('Baselines', (modelResult.summary.baselineOpponents || []).join(', ') || 'n/a'),
    ].join('');

    if (!selectedIteration) {
      iterationMeta.innerHTML = '';
      rewardSignals.innerHTML = '';
      leaderboardSnapshot.innerHTML = listRow('No successful iterations', 'n/a');
      historySnapshot.innerHTML = '';
      codeViewer.textContent = '// no generated code available';
      snapshotMeta.innerHTML = '';
      drawGrid(null);
      return;
    }

    iterationMeta.innerHTML = [
      metaItem('Iteration', selectedIteration.iter),
      metaItem('Prompt mode', selectedIteration.promptMode || 'n/a'),
      metaItem('Average territory', `${selectedIteration.avgPct}%`),
      metaItem('Average ticks', selectedIteration.avgTicks ?? 'n/a'),
      metaItem('Delta vs last', selectedIteration.improvementFromLastIter == null ? 'n/a' : `${selectedIteration.improvementFromLastIter > 0 ? '+' : ''}${selectedIteration.improvementFromLastIter}%`),
      metaItem('Delta vs best before', selectedIteration.improvementFromBestBeforeIter == null ? 'n/a' : `${selectedIteration.improvementFromBestBeforeIter > 0 ? '+' : ''}${selectedIteration.improvementFromBestBeforeIter}%`),
    ].join('');

    rewardSignals.innerHTML = (selectedIteration.promptFeedback?.rewardSignals || []).length
      ? selectedIteration.promptFeedback.rewardSignals.map(signal => `<span class="chip">${escapeHtml(signal)}</span>`).join('')
      : '<span class="chip">first round, no prior reward signals</span>';

    const leaderboard = selectedIteration.promptFeedback?.leaderboard || [];
    leaderboardSnapshot.innerHTML = leaderboard.length
      ? leaderboard.map(entry => listRow(`${entry.name}`, `${entry.avgPct}% over ${entry.runs} runs`)).join('')
      : listRow('No prior leaderboard yet', selectedIteration.promptMode === 'baseline' ? 'baseline round' : 'n/a');

    const history = selectedIteration.promptFeedback?.recentHistory || [];
    historySnapshot.innerHTML = history.length
      ? history.map(entry => listRow(`Iter ${entry.iter}: ${entry.algoName}`, `${entry.avgPct}% in ${entry.ticks} ticks`)).join('')
      : listRow('No recent history yet', selectedIteration.promptMode === 'baseline' ? 'baseline round' : 'n/a');

    codeViewer.textContent = selectedIteration.rawCode || '// no generated code captured';

    if (selectedIteration.representativeGame && selectedIteration.representativeGame.finalGrid) {
      snapshotMeta.innerHTML = [
        metaItem('Representative game', `#${selectedIteration.representativeGame.gameNumber}`),
        metaItem('Territory', `${selectedIteration.representativeGame.pct}%`),
        metaItem('Ticks', selectedIteration.representativeGame.ticks),
        metaItem('Winner slot', `Player ${selectedIteration.representativeGame.winnerIndex + 1}`),
      ].join('');
      drawGrid(selectedIteration.representativeGame.finalGrid);
    } else {
      snapshotMeta.innerHTML = metaItem('Snapshot', 'Not available in this result file');
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

  function drawGrid(grid) {
    const ctx = snapshotCanvas.getContext('2d');
    const canvasSize = snapshotCanvas.width;

    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.fillStyle = '#f7f7f7';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    if (!grid || !grid.length) {
      ctx.fillStyle = '#888';
      ctx.font = '13px system-ui, sans-serif';
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
          ctx.fillStyle = 'rgba(120, 120, 120, 0.16)';
        } else {
          ctx.fillStyle = COLORS[cell % COLORS.length];
        }
        ctx.fillRect(col * px, row * px, px, px);
      }
    }
  }

  loadResults();
})();
