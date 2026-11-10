/**
 * Dashboard UI Client (v7 - Servidor Node.js de Alta Fluidez I/O & Módulos Python PoW)
 */

let worker = null;
let attackInterval = null;
let lastSolvedChallenge = null;
let lastSolvedNonce = null;

// Elementos DOM de Métricas
const metricRps = document.getElementById('metric-rps');
const metricCpuSaved = document.getElementById('metric-cpu-saved');
const metricRejectedPct = document.getElementById('metric-rejected-pct');
const metricReplay = document.getElementById('metric-replay');
const metricVerified = document.getElementById('metric-verified');
const metricRejected = document.getElementById('metric-rejected');

const autotuneBanner = document.getElementById('autotune-banner');
const autotuneIcon = document.getElementById('autotune-icon');
const autotuneText = document.getElementById('autotune-text');
const autotuneSub = document.getElementById('autotune-sub');

const clientTerminal = document.getElementById('client-terminal');
const serverLogsTerminal = document.getElementById('server-logs-terminal');
const selectDifficulty = document.getElementById('select-difficulty');

const btnNoPow = document.getElementById('btn-no-pow');
const btnWithPow = document.getElementById('btn-with-pow');
const btnReplayAttack = document.getElementById('btn-replay-attack');

const btnSimNopow = document.getElementById('btn-sim-nopow');
const btnSimMasivo = document.getElementById('btn-sim-masivo');
const btnSimMixto = document.getElementById('btn-sim-mixto');
const btnSimStop = document.getElementById('btn-sim-stop');

const btnRunBenchmark = document.getElementById('btn-run-benchmark');
const benchmarkChartImg = document.getElementById('benchmark-chart-img');
const benchmarkStatusBox = document.getElementById('benchmark-status-box');
const benchmarkActivitySummary = document.getElementById('benchmark-activity-summary');
const btnRunDistributedBenchmark = document.getElementById('btn-run-distributed-benchmark');
const distributedBenchmarkStatus = document.getElementById('distributed-benchmark-status');
const distributedBenchmarkResults = document.getElementById('distributed-benchmark-results');
const daskLivePanel = document.getElementById('dask-live-panel');
const daskDashboardLink = document.getElementById('dask-dashboard-link');
const chartLightbox = document.getElementById('chart-lightbox');
const chartLightboxContent = document.getElementById('chart-lightbox-content');
const chartLightboxClose = document.getElementById('chart-lightbox-close');

function openChartLightbox(source) {
  chartLightboxContent.replaceChildren();
  let enlarged;

  if (source instanceof HTMLCanvasElement) {
    enlarged = document.createElement('canvas');
    enlarged.width = source.width;
    enlarged.height = source.height;
    enlarged.setAttribute('aria-label', source.getAttribute('aria-label') || 'Gráfica ampliada');
    enlarged.getContext('2d').drawImage(source, 0, 0);
  } else {
    enlarged = document.createElement('img');
    enlarged.src = source.currentSrc || source.src;
    enlarged.alt = source.alt;
  }

  chartLightboxContent.appendChild(enlarged);
  chartLightbox.classList.add('is-open');
  chartLightboxClose.focus();
}

function closeChartLightbox() {
  chartLightbox.classList.remove('is-open');
  chartLightboxContent.replaceChildren();
}

document.querySelectorAll('.chart-expandable').forEach(chart => {
  chart.addEventListener('click', () => openChartLightbox(chart));
  chart.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openChartLightbox(chart);
    }
  });
});

chartLightboxClose.addEventListener('click', closeChartLightbox);
chartLightbox.addEventListener('click', event => {
  if (event.target === chartLightbox) closeChartLightbox();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && chartLightbox.classList.contains('is-open')) {
    closeChartLightbox();
  }
});

const workerState = document.getElementById('worker-state');
const workerHashes = document.getElementById('worker-hashes');
const workerHashrate = document.getElementById('worker-hashrate');
const workerTime = document.getElementById('worker-time');
const progressFill = document.getElementById('progress-fill');
const blockchainSummary = document.getElementById('blockchain-summary');
const blockchainBlocks = document.getElementById('blockchain-blocks');

// LOGGING
function logClient(msg, type = 'normal') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  const time = new Date().toLocaleTimeString('es-ES');
  line.textContent = `[${time}] ${msg}`;
  clientTerminal.appendChild(line);
  clientTerminal.scrollTop = clientTerminal.scrollHeight;
}

function updateServerLogs(logs) {
  if (!logs || !logs.length) return;
  serverLogsTerminal.innerHTML = '';
  logs.forEach(log => {
    const line = document.createElement('div');
    line.className = `log-line ${log.type === 'AUTOTUNING' ? 'warn' : (log.type === 'REJECTED' ? 'error' : 'normal')}`;
    line.textContent = `[${log.time}] [${log.type}] ${log.message}`;
    serverLogsTerminal.appendChild(line);
  });
  serverLogsTerminal.scrollTop = serverLogsTerminal.scrollHeight;
}

// CANVAS REALTIME GRAPH
const canvas = document.getElementById('realtime-canvas');
const ctx = canvas.getContext('2d');
const chartTooltip = document.getElementById('realtime-chart-tooltip');
let realtimeSeries = [];

function setupCanvas() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (realtimeSeries.length) renderRealtimeChart(realtimeSeries);
}

function renderRealtimeChart(timeSeries) {
  if (!timeSeries || !timeSeries.length) return;
  realtimeSeries = timeSeries;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const pad = { left: 48, right: 48, top: 38, bottom: 32 };
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const plotHeight = Math.max(1, height - pad.top - pad.bottom);
  const maxRps = Math.max(5, Math.ceil(Math.max(...timeSeries.map(d => Number(d.rps) || 0)) / 5) * 5);
  const maxDifficulty = Math.max(6, ...timeSeries.map(d => Number(d.difficulty) || 0));
  const xFor = index => pad.left + (timeSeries.length < 2 ? plotWidth / 2 : index * plotWidth / (timeSeries.length - 1));
  const yForRps = value => pad.top + plotHeight - ((Number(value) || 0) / maxRps) * plotHeight;
  const yForDifficulty = value => pad.top + plotHeight - ((Number(value) || 0) / maxDifficulty) * plotHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;

  // Eje Y izquierdo: solicitudes por segundo; eje derecho: dificultad PoW.
  for (let tick = 0; tick <= 4; tick++) {
    const y = pad.top + plotHeight - (tick / 4) * plotHeight;
    ctx.strokeStyle = '#263449';
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText((maxRps * tick / 4).toFixed(0), pad.left - 8, y);
    ctx.textAlign = 'left';
    ctx.fillText((maxDifficulty * tick / 4).toFixed(1), width - pad.right + 8, y);
  }

  ctx.strokeStyle = '#64748b';
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotHeight);
  ctx.lineTo(width - pad.right, pad.top + plotHeight);
  ctx.lineTo(width - pad.right, pad.top);
  ctx.stroke();

  // Etiquetas de ejes para identificar unidades y periodo.
  ctx.fillStyle = '#cbd5e1';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Tiempo (hora)', pad.left + plotWidth / 2, height - 15);
  ctx.save();
  ctx.translate(12, pad.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Solicitudes por segundo', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(width - 10, pad.top + plotHeight / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillText('Dificultad (ceros hex)', 0, 0);
  ctx.restore();

  const labelCount = Math.min(5, timeSeries.length);
  for (let tick = 0; tick < labelCount; tick++) {
    const index = labelCount === 1 ? 0 : Math.round(tick * (timeSeries.length - 1) / (labelCount - 1));
    const x = xFor(index);
    ctx.strokeStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(x, pad.top + plotHeight);
    ctx.lineTo(x, pad.top + plotHeight + 4);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = tick === 0 ? 'left' : tick === labelCount - 1 ? 'right' : 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(timeSeries[index].time || ''), x, pad.top + plotHeight + 6);
  }

  // 1. Dibujar curva RPS Total (Rojo)
  ctx.beginPath();
  ctx.strokeStyle = '#f87171';
  ctx.lineWidth = 2;
  timeSeries.forEach((pt, i) => {
    const x = xFor(i);
    const y = yForRps(pt.rps);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  timeSeries.forEach((pt, i) => {
    ctx.beginPath();
    ctx.arc(xFor(i), yForRps(pt.rps), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f87171';
    ctx.fill();
  });

  // 2. Dibujar Dificultad (Morado punteado)
  ctx.beginPath();
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  timeSeries.forEach((pt, i) => {
    const x = xFor(i);
    const y = yForDifficulty(pt.difficulty);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  timeSeries.forEach((pt, i) => {
    ctx.beginPath();
    ctx.arc(xFor(i), yForDifficulty(pt.difficulty), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#c084fc';
    ctx.fill();
  });
}

canvas.addEventListener('mousemove', event => {
  if (!realtimeSeries.length) return;
  const rect = canvas.getBoundingClientRect();
  const padLeft = 48;
  const padRight = 48;
  const plotWidth = Math.max(1, rect.width - padLeft - padRight);
  const position = Math.max(0, Math.min(1, (event.clientX - rect.left - padLeft) / plotWidth));
  const index = Math.round(position * Math.max(0, realtimeSeries.length - 1));
  const point = realtimeSeries[index];
  const wrapperRect = canvas.parentElement.getBoundingClientRect();
  chartTooltip.innerHTML = `<strong>${point.time || 'Medición'}</strong><br>Solicitudes: ${Number(point.rps || 0).toFixed(1)} req/s<br>Dificultad: ${point.difficulty} ceros hex<br>Verificadas: ${point.verified ?? 0} · Rechazadas: ${point.rejected ?? 0}`;
  chartTooltip.style.display = 'block';
  chartTooltip.style.left = `${Math.min(Math.max(8, event.clientX - wrapperRect.left + 12), wrapperRect.width - 220)}px`;
  chartTooltip.style.top = `${Math.max(8, event.clientY - wrapperRect.top - 12)}px`;
});

canvas.addEventListener('mouseleave', () => { chartTooltip.style.display = 'none'; });

// POLLING DE MÉTRICAS
async function fetchMetrics() {
  try {
    const res = await fetch('/api/metrics');
    if (!res.ok) return;
    const data = await res.json();

    metricRps.textContent = data.requestsPerSecond.toFixed(1);
    metricCpuSaved.textContent = `${data.cpuSavedPct.toFixed(1)}%`;
    metricRejectedPct.textContent = `${data.rejectedPct.toFixed(1)}%`;
    metricReplay.textContent = data.totalReplayPrevented;
    metricVerified.textContent = data.totalVerified;
    metricRejected.textContent = data.totalRejected;

    if (data.currentDifficulty === 4) {
      autotuneBanner.className = 'autotune-banner';
      autotuneIcon.textContent = '🟢';
      autotuneText.textContent = `Estado Normal: Dificultad en 4 ceros hex (16 bits) | Carga: ${data.requestsPerSecond} req/s`;
      autotuneSub.textContent = 'Tráfico Estable - Cómputo cliente aprox: ~0.05s';
    } else if (data.currentDifficulty === 5) {
      autotuneBanner.className = 'autotune-banner alert-warning';
      autotuneIcon.textContent = '⚠️';
      autotuneText.textContent = `Carga Moderada: Dificultad Escalada a 5 ceros (20 bits) | Carga: ${data.requestsPerSecond} req/s`;
      autotuneSub.textContent = 'Autotuning Activo - Cómputo cliente aprox: ~1.0s';
    } else {
      autotuneBanner.className = 'autotune-banner alert-danger';
      autotuneIcon.textContent = '🚨';
      autotuneText.textContent = `¡ATAQUE DDOS DETECTADO! Dificultad Máxima: 6 ceros (24 bits) | Carga: ${data.requestsPerSecond} req/s`;
      autotuneSub.textContent = 'Modo Protección DDoS - Cómputo cliente penalizado: ~15-30s';
    }

    if (data.eventLogs) updateServerLogs(data.eventLogs);
    if (data.timeSeries) renderRealtimeChart(data.timeSeries);

  } catch (err) {}
}

async function fetchBlockchain() {
  if (!blockchainSummary || !blockchainBlocks) return;
  try {
    const response = await fetch('/api/blockchain');
    const data = await response.json();
    const status = data.lastError ? `Error: ${data.lastError}` :
      data.mining ? 'Minando un bloque…' : data.queuedEvents ? `${data.queuedEvents} evento(s) en cola…` :
      data.valid ? 'Cadena válida' : 'La cadena necesita revisión';
    blockchainSummary.textContent = `${status} · ${data.blockCount} bloque(s) · dificultad de cadena ${data.difficultyBits} bits · pendientes omitidos: ${data.droppedEvents || 0}`;
    blockchainBlocks.replaceChildren();
    if (!data.blocks || !data.blocks.length) {
      blockchainBlocks.textContent = 'Aún no hay eventos guardados. Prueba «Seguro», «Sin PoW», «Replay Attack» o cambia la dificultad.';
      return;
    }
    data.blocks.slice(0, 10).forEach(block => {
      const blockLine = document.createElement('div');
      blockLine.className = 'log-line warn';
      const events = block.transactions || [];
      blockLine.textContent = `Bloque #${block.index} · ${events.length} evento(s) · ${block.hash.slice(0, 24)}… · PoW ${block.difficultyBits} bits`;
      blockchainBlocks.appendChild(blockLine);
      events.forEach(event => {
        const eventLine = document.createElement('div');
        eventLine.className = 'log-line';
        const time = event.timestamp ? new Date(event.timestamp * 1000).toLocaleTimeString('es-ES') : '';
        eventLine.textContent = `  └ ${time} · ${event.type || 'EVENTO'} · ${event.message || event.endpoint || ''}`;
        blockchainBlocks.appendChild(eventLine);
      });
    });
  } catch (error) {
    blockchainSummary.textContent = `No se pudo consultar la blockchain: ${error.message}`;
  }
}

// 1. SOLICITUD SIN POW
btnNoPow.addEventListener('click', async () => {
  logClient('Enviando solicitud directa a POST /api/heavy-report (Sin cabeceras PoW)...');
  try {
    const start = performance.now();
    const res = await fetch('/api/heavy-report', { method: 'POST' });
    const elapsed = (performance.now() - start).toFixed(2);
    const data = await res.json();

    if (res.status === 428) {
      logClient(`❌ RECHAZADO POR NODE.JS (HTTP 428) en ${elapsed}ms. Razón: ${data.reason}`, 'error');
    } else {
      logClient(`Respuesta inesperada: HTTP ${res.status}`, 'warn');
    }
  } catch (err) {
    logClient(`Error de red: ${err.message}`, 'error');
  }
});

// 2. SOLICITUD CON POW WORKER
btnWithPow.addEventListener('click', async () => {
  btnWithPow.disabled = true;
  logClient('1. Solicitando reto a GET /api/pow/challenge...');

  try {
    const chRes = await fetch('/api/pow/challenge?clientId=browser-user');
    const chData = await chRes.json();
    logClient(`Reto recibido (Dificultad = ${chData.difficulty} ceros). Minando en Web Worker...`);

    workerState.textContent = 'Minando en Web Worker...';
    workerState.style.color = 'var(--accent-warning)';
    progressFill.style.width = '35%';

    if (worker) worker.terminate();
    worker = new Worker('pow-worker.js');

    worker.onmessage = async (e) => {
      const msg = e.data;

      if (msg.type === 'PROGRESS') {
        workerHashes.textContent = msg.hashesTested.toLocaleString();
        workerHashrate.textContent = `${msg.hashRate.toLocaleString()} H/s`;
        workerTime.textContent = `${msg.elapsedMs} ms (Cliente)`;
        progressFill.style.width = `${Math.min(90, 35 + (msg.hashesTested / 10000) * 50)}%`;
      } else if (msg.type === 'ERROR') {
        workerState.textContent = 'Error al minar';
        workerState.style.color = 'var(--accent-danger)';
        logClient(msg.message, 'error');
        worker.terminate();
        worker = null;
        btnWithPow.disabled = false;
      } else if (msg.type === 'SUCCESS') {
        const { nonce, hash, totalTimeMs, totalHashes } = msg;

        lastSolvedChallenge = chData.challenge;
        lastSolvedNonce = nonce;

        workerState.textContent = '¡Solución Encontrada!';
        workerState.style.color = 'var(--accent-green)';
        workerHashes.textContent = totalHashes.toLocaleString();
        workerTime.textContent = `${totalTimeMs} ms`;
        progressFill.style.width = '100%';

        logClient(`2. PoW Resuelto en ${totalTimeMs}ms! Nonce: ${nonce} (Hash: ${hash.slice(0, 10)}...)`, 'success');
        logClient('3. Enviando solución al API Gateway Node.js en cabeceras HTTP...');

        const apiRes = await fetch('/api/heavy-report', {
          method: 'POST',
          headers: {
            'X-PoW-Challenge': chData.challenge,
            'X-PoW-Response': nonce
          }
        });

        const apiData = await apiRes.json();
        if (apiRes.status === 200) {
          logClient(`✅ ACCESO CONCEDIDO (HTTP 200)! Servidor Node.js verificó en ${apiData.powMetrics.serverVerifyTimeMs}ms.`, 'success');
        } else {
          logClient(`❌ Rechazado por Servidor: ${apiData.reason}`, 'error');
        }

        btnWithPow.disabled = false;
      }
    };

    worker.postMessage({ challenge: chData.challenge, difficulty: chData.difficulty });

  } catch (err) {
    logClient(`Error en flujo PoW: ${err.message}`, 'error');
    btnWithPow.disabled = false;
  }
});

// 3. REPLAY ATTACK
btnReplayAttack.addEventListener('click', async () => {
  if (!lastSolvedChallenge || !lastSolvedNonce) {
    logClient('⚠️ Primero debes resolver al menos un reto PoW con el botón "Seguro (Web Worker)".', 'warn');
    return;
  }

  logClient('🔄 Intentando REUSAR el mismo reto PoW y nonce resuelto previamente...', 'warn');
  try {
    const res = await fetch('/api/heavy-report', {
      method: 'POST',
      headers: {
        'X-PoW-Challenge': lastSolvedChallenge,
        'X-PoW-Response': lastSolvedNonce
      }
    });

    const data = await res.json();
    if (res.status === 428) {
      logClient(`🛡️ REPLAY ATTACK REPELIDO POR NODE.JS (HTTP 428)! Razón: ${data.reason}`, 'error');
    } else {
      logClient(`Inesperado: El servidor aceptó la reutilización (HTTP ${res.status})`, 'warn');
    }
  } catch (err) {
    logClient(`Error en prueba Replay: ${err.message}`, 'error');
  }
});

// 4. SIMULADOR DDOS
function startDdosAttack(mode) {
  stopDdosAttack();
  btnSimNopow.disabled = true;
  btnSimMasivo.disabled = true;
  btnSimMixto.disabled = true;
  btnSimStop.disabled = false;

  if (mode === 'nopow') {
    logClient('🔥 ATAQUE BOTNET DIRECTO INICIADO (50 peticiones/s al Servidor Node.js)...', 'error');
    attackInterval = setInterval(() => {
      for (let i = 0; i < 5; i++) {
        fetch('/api/heavy-report', { method: 'POST' }).catch(() => {});
      }
    }, 100);
  } else if (mode === 'masivo') {
    logClient('💥 ATAQUE BOTNET MASIVO INICIADO (100 Bots Simultáneos enviando ráfagas)...', 'error');
    attackInterval = setInterval(() => {
      for (let i = 0; i < 15; i++) {
        fetch('/api/heavy-report', { method: 'POST' }).catch(() => {});
      }
    }, 50);
  } else if (mode === 'mixto') {
    logClient('👥 ATAQUE MIXTO INICIADO: Usuarios reales (Web Worker) + Botnet masiva...', 'warn');
    attackInterval = setInterval(() => {
      for (let i = 0; i < 8; i++) {
        fetch('/api/heavy-report', { method: 'POST' }).catch(() => {});
      }
      fetch('/api/pow/challenge?clientId=real-user-sim')
        .then(r => r.json())
        .then(ch => {
          fetch('/api/heavy-report', {
            method: 'POST',
            headers: { 'X-PoW-Challenge': ch.challenge, 'X-PoW-Response': '12345' }
          }).catch(() => {});
        }).catch(() => {});
    }, 80);
  }
}

function stopDdosAttack() {
  if (attackInterval) {
    clearInterval(attackInterval);
    attackInterval = null;
    logClient('🛑 ATAQUE DETENIDO por el operador.', 'success');
  }
  btnSimNopow.disabled = false;
  btnSimMasivo.disabled = false;
  btnSimMixto.disabled = false;
  btnSimStop.disabled = true;
}

btnSimNopow.addEventListener('click', () => startDdosAttack('nopow'));
btnSimMasivo.addEventListener('click', () => startDdosAttack('masivo'));
btnSimMixto.addEventListener('click', () => startDdosAttack('mixto'));
btnSimStop.addEventListener('click', stopDdosAttack);

// 5. CAMBIO DE DIFICULTAD MANUAL
selectDifficulty.addEventListener('change', async () => {
  const diff = selectDifficulty.value;
  try {
    const res = await fetch('/api/admin/difficulty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty: diff })
    });
    const data = await res.json();
    logClient(`Dificultad cambiada en Servidor Node.js a: ${diff}`, 'warn');
  } catch (err) {
    logClient(`Error cambiando dificultad: ${err.message}`, 'error');
  }
});

// 6. EJECUCIÓN DE BENCHMARK PYTHON
btnRunBenchmark.addEventListener('click', async () => {
  btnRunBenchmark.disabled = true;
  benchmarkStatusBox.style.display = 'block';
  logClient('🚀 Invocando suite de benchmark en el Servidor Python (run_benchmark.py + plot_benchmark.py)...');

  try {
    const res = await fetch('/api/benchmark/run', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      logClient('✅ Benchmark criptográfico Python completado con éxito! Gráficos Matplotlib actualizados.', 'success');
      benchmarkChartImg.style.display = 'inline-block';
      benchmarkChartImg.src = data.chartUrl;
      const activity = data.activityDuringRun;
      if (activity) {
        benchmarkActivitySummary.replaceChildren();
        const heading = document.createElement('strong');
        heading.textContent = 'Actividad real durante el benchmark';
        const details = document.createElement('div');
        details.textContent = `${activity.durationSeconds}s · ${activity.requestsObserved} solicitudes HTTP · ` +
          `${activity.verifiedPoWs} PoW aceptados · ${activity.rejectedRequests} rechazados · ` +
          `${activity.replayAttempts} replays · pico ${activity.peakRequestsPerSecond} req/s · ` +
          `dificultad ${activity.difficultiesObserved.join(', ') || 'sin datos'}`;
        const note = document.createElement('div');
        note.textContent = 'Incluye lo que ocurrió mientras corría: usa «Seguro» o inicia una simulación de ataque durante ese intervalo para verlo reflejado.';
        benchmarkActivitySummary.append(heading, details, note);
        benchmarkActivitySummary.style.display = 'block';
      }
    } else {
      logClient(`❌ Error en benchmark Python: ${data.error}`, 'error');
    }
  } catch (err) {
    logClient(`Error ejecutando benchmark: ${err.message}`, 'error');
  } finally {
    btnRunBenchmark.disabled = false;
    benchmarkStatusBox.style.display = 'none';
  }
});

function renderDistributedBenchmarkResults(payload) {
  const results = payload?.results || payload;
  if (!results?.results?.length) return;

  distributedBenchmarkResults.replaceChildren();
  const table = document.createElement('table');
  table.className = 'distributed-benchmark-table';
  const headers = ['Dificultad', 'Workers', 'Secuencial (s)', 'Dask (s)', 'Aceleración', 'Eficiencia', 'Pruebas válidas'];
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  results.results.forEach(row => {
    const tr = document.createElement('tr');
    const values = [
      `${row.difficulty_bits} bits`, row.workers,
      Number(row.sequential_median_seconds).toFixed(4),
      Number(row.distributed_median_seconds).toFixed(4),
      `${Number(row.speedup_vs_sequential).toFixed(2)}×`,
      `${(Number(row.parallel_efficiency) * 100).toFixed(1)}%`,
      row.all_proofs_valid ? 'Sí' : 'No'
    ];
    values.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = String(value);
      if (index === 6) td.style.color = row.all_proofs_valid ? 'var(--accent-green)' : 'var(--accent-danger)';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const wrapper = document.createElement('div');
  wrapper.className = 'distributed-benchmark-table-wrap';
  wrapper.appendChild(table);
  distributedBenchmarkResults.appendChild(wrapper);

  const env = results.environment || {};
  const envSummary = [env.python && `Python ${env.python}`, env.cpu_count && `${env.cpu_count} CPU(s)`]
    .filter(Boolean).join(' · ');
  distributedBenchmarkStatus.textContent = `Resultados: ${results.results.length} configuraciones · ${envSummary || 'equipo local'}.`;
}

let distributedBenchmarkPolling = false;

async function refreshDistributedBenchmarkStatus() {
  try {
    const response = await fetch('/api/benchmark/distributed/status');
    const state = await response.json();
    const results = state.results;
    if (results?.results?.length) renderDistributedBenchmarkResults(results);
    const dashboardUrl = results?.dashboard_url;
    if (state.running && dashboardUrl) {
      try {
        const parsedDashboardUrl = new URL(dashboardUrl);
        if (parsedDashboardUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsedDashboardUrl.hostname)) {
          daskDashboardLink.href = parsedDashboardUrl.href;
          daskLivePanel.style.display = 'block';
        }
      } catch (error) {
        daskLivePanel.style.display = 'none';
      }
    } else {
      daskLivePanel.style.display = 'none';
    }
    btnRunDistributedBenchmark.disabled = Boolean(state.running);
    if (state.lastError) {
      distributedBenchmarkStatus.textContent = `El benchmark no pudo completarse: ${state.lastError}`;
    } else if (state.running) {
      const completed = results?.completed ?? results?.results?.length ?? 0;
      const total = results?.total ?? 9;
      distributedBenchmarkStatus.textContent = `En ejecución: ${completed} de ${total} configuraciones listas. La tabla se actualiza al completar cada una.`;
    } else if (results?.results?.length) {
      distributedBenchmarkStatus.textContent = `Completado: ${results.results.length} configuraciones · se muestran los resultados más recientes.`;
    } else {
      distributedBenchmarkStatus.textContent = 'Aún no hay resultados. Pulsa «Ejecutar comparación Dask».';
    }
    return state;
  } catch (error) {
    distributedBenchmarkStatus.textContent = `No se pudo consultar el benchmark: ${error.message}`;
    return null;
  }
}

async function monitorDistributedBenchmark(logCompletion = false) {
  if (distributedBenchmarkPolling) return;
  distributedBenchmarkPolling = true;
  try {
    let state;
    do {
      state = await refreshDistributedBenchmarkStatus();
      if (state?.running) await new Promise(resolve => setTimeout(resolve, 1000));
    } while (state?.running);
    if (logCompletion && state?.results?.results?.length && !state.lastError) {
      logClient('✅ Benchmark distribuido Dask completado; resultados y validez de las pruebas actualizados.', 'success');
    }
  } finally {
    distributedBenchmarkPolling = false;
    btnRunDistributedBenchmark.disabled = false;
  }
}

btnRunDistributedBenchmark.addEventListener('click', async () => {
  btnRunDistributedBenchmark.disabled = true;
  distributedBenchmarkStatus.textContent = 'Iniciando benchmark Dask…';
  try {
    const response = await fetch('/api/benchmark/distributed/run', { method: 'POST' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
    await monitorDistributedBenchmark(true);
  } catch (error) {
    distributedBenchmarkStatus.textContent = `Falló el benchmark distribuido: ${error.message}`;
    logClient(`Error ejecutando benchmark Dask: ${error.message}`, 'error');
  } finally {
    btnRunDistributedBenchmark.disabled = distributedBenchmarkPolling;
  }
});

// Inicialización
window.addEventListener('resize', setupCanvas);
setupCanvas();
setInterval(fetchMetrics, 1000);
fetchMetrics();
setInterval(fetchBlockchain, 1500);
fetchBlockchain();
monitorDistributedBenchmark();
