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

const workerState = document.getElementById('worker-state');
const workerHashes = document.getElementById('worker-hashes');
const workerHashrate = document.getElementById('worker-hashrate');
const workerTime = document.getElementById('worker-time');
const progressFill = document.getElementById('progress-fill');

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

function setupCanvas() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function renderRealtimeChart(timeSeries) {
  if (!timeSeries || timeSeries.length < 2) return;
  const width = canvas.width / window.devicePixelRatio;
  const height = canvas.height / window.devicePixelRatio;

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 0.5;
  for (let y = 0; y < height; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const maxRps = Math.max(15, ...timeSeries.map(d => d.rps || 0));
  const stepX = width / (timeSeries.length - 1);

  // 1. Dibujar curva RPS Total (Rojo)
  ctx.beginPath();
  ctx.strokeStyle = '#f87171';
  ctx.lineWidth = 2;
  timeSeries.forEach((pt, i) => {
    const x = i * stepX;
    const y = height - (pt.rps / maxRps) * (height - 30) - 15;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 2. Dibujar Dificultad (Morado punteado)
  ctx.beginPath();
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  timeSeries.forEach((pt, i) => {
    const x = i * stepX;
    const y = height - ((pt.difficulty * 10) / 70) * (height - 30) - 15;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

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

// Inicialización
window.addEventListener('resize', setupCanvas);
setupCanvas();
setInterval(fetchMetrics, 1000);
fetchMetrics();
