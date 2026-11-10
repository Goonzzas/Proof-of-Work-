/**
 * Servidor HTTP Enterprise Rate Limiter basado en Proof-of-Work (Hashcash)
 * Arquitectura: Node.js (Servidor de alta fluidez I/O no bloqueante) + Módulos de Python para Algoritmos PoW y Benchmark
 * 
 * Proyecto Académico: Sistema de Rate Limiting y Anti-DDoS para APIs Empresariales (v7)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { exec, spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const SECRET_KEY = crypto.randomBytes(32).toString('hex'); // Llave privada de firma HMAC
const BLOCKCHAIN_FILE = path.join(__dirname, 'data', 'blockchain_events.json');
const BLOCKCHAIN_BRIDGE = path.join(__dirname, 'blockchain_event_bridge.py');
const PYTHON = process.env.PYTHON_EXECUTABLE || (fs.existsSync(path.join(__dirname, '.venv', 'bin', 'python'))
  ? path.join(__dirname, '.venv', 'bin', 'python') : 'python3');
const blockchainQueue = [];
let blockchainFlushTimer = null;
let blockchainMining = false;
let blockchainLastError = null;
let blockchainDroppedEvents = 0;

function queueBlockchainEvent(event) {
  if (blockchainQueue.length >= 500) {
    blockchainDroppedEvents++;
    return;
  }
  blockchainQueue.push(event);
  if (!blockchainFlushTimer && !blockchainMining) {
    blockchainFlushTimer = setTimeout(flushBlockchainEvents, 700);
  }
}

function flushBlockchainEvents() {
  blockchainFlushTimer = null;
  if (blockchainMining || blockchainQueue.length === 0) return;
  const batch = blockchainQueue.splice(0, 20);
  blockchainMining = true;
  const child = spawn(PYTHON, [BLOCKCHAIN_BRIDGE, '--store', BLOCKCHAIN_FILE], { cwd: __dirname });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  child.on('error', error => finishBlockchainBatch(error));
  child.on('close', code => {
    if (code !== 0) return finishBlockchainBatch(new Error(stderr || `bridge terminó con código ${code}`));
    try {
      const result = JSON.parse(stdout);
      blockchainLastError = null;
      trafficManager.logEvent('BLOCKCHAIN', `${batch.length} solicitud(es) válida(s) guardada(s) en bloque #${result.block.index}.`);
    } catch (error) {
      finishBlockchainBatch(new Error(`respuesta inválida del bridge: ${error.message}`));
      return;
    }
    blockchainMining = false;
    if (blockchainQueue.length && !blockchainFlushTimer) blockchainFlushTimer = setTimeout(flushBlockchainEvents, 100);
  });
  child.stdin.end(JSON.stringify(batch));

  function finishBlockchainBatch(error) {
    if (!blockchainMining) return;
    blockchainQueue.unshift(...batch);
    blockchainLastError = error.message;
    trafficManager.logEvent('BLOCKCHAIN_ERROR', `No se pudo guardar el bloque: ${error.message}`);
    blockchainMining = false;
    if (!blockchainFlushTimer) blockchainFlushTimer = setTimeout(flushBlockchainEvents, 5000);
  }
}

function readBlockchainState() {
  try {
    if (!fs.existsSync(BLOCKCHAIN_FILE)) return { blocks: [], valid: true, queuedEvents: blockchainQueue.length };
    const saved = JSON.parse(fs.readFileSync(BLOCKCHAIN_FILE, 'utf8'));
    return { ...saved, queuedEvents: blockchainQueue.length };
  } catch (error) {
    return { blocks: [], valid: false, error: error.message, queuedEvents: blockchainQueue.length };
  }
}

// --- GESTOR DE TRÁFICO Y DIFICULTAD DINÁMICA (AUTOTUNING) ---
class TrafficManager {
  constructor() {
    this.requestHistory = [];
    this.totalRequests = 0;
    this.manualDifficulty = null; // Sobrescritura manual
    this.totalVerified = 0;
    this.totalRejected = 0;
    this.totalReplayPrevented = 0;
    this.eventLogs = [];
    this.timeSeries = [];
    this.startTime = Date.now();
    this.usedSignatures = new Set(); // Prevención de Replay Attacks
  }

  recordRequest() {
    this.totalRequests++;
    const now = Date.now();
    this.requestHistory.push(now);
    // Conservar solo solicitudes de los últimos 10 segundos
    this.requestHistory = this.requestHistory.filter(t => now - t <= 10000);
  }

  getRequestsPerSecond() {
    const now = Date.now();
    this.requestHistory = this.requestHistory.filter(t => now - t <= 10000);
    return parseFloat((this.requestHistory.length / 10).toFixed(1));
  }

  getCurrentDifficulty() {
    if (this.manualDifficulty !== null) {
      return this.manualDifficulty;
    }
    const rps = this.getRequestsPerSecond();
    if (rps < 5.0) {
      return 4; // Normal: 4 ceros hex (16 bits) ~ 0.05s
    } else if (rps < 15.0) {
      return 5; // Carga Moderada: 5 ceros hex (20 bits) ~ 1.0s
    } else {
      return 6; // Bajo Ataque DDoS: 6 ceros hex (24 bits) ~ 15-30s
    }
  }

  setManualDifficulty(diff) {
    if (diff === 'auto' || diff === null || diff === undefined) {
      this.manualDifficulty = null;
      this.logEvent('AUTOTUNING', 'Modo de dificultad restaurado a Automático (según RPS).');
    } else {
      this.manualDifficulty = parseInt(diff, 10);
      this.logEvent('CONFIG', `Dificultad sobrescrita manualmente a ${this.manualDifficulty} ceros hex.`);
    }
  }

  logEvent(type, message) {
    const timeStr = new Date().toLocaleTimeString('es-ES');
    this.eventLogs.push({ time: timeStr, type, message });
    if (this.eventLogs.length > 40) {
      this.eventLogs.shift();
    }

    // Replicar eventos de auditoría en la cadena; se excluyen los mensajes del
    // propio minado para evitar que registrar un bloque genere otro evento.
    if (!['BLOCKCHAIN', 'BLOCKCHAIN_ERROR', 'SYS'].includes(type)) {
      let eventType = type;
      let summary = String(message).slice(0, 180);
      const hash = type === 'VERIFIED' ? String(message).match(/Hash: ([a-f0-9]+)/i)?.[1] : null;
      if (type === 'VERIFIED') {
        eventType = 'REQUEST_VERIFIED';
        summary = hash ? `Solicitud autorizada mediante PoW (hash ${hash})` : 'Solicitud autorizada mediante PoW';
      } else if (type === 'REJECTED' && String(message).includes('Replay Attack')) {
        eventType = 'REPLAY_ATTEMPT';
        summary = 'Intento de reutilizar una prueba PoW rechazado';
      } else if (type === 'REJECTED') {
        eventType = 'REQUEST_REJECTED';
        summary = 'Solicitud rechazada: prueba PoW ausente o inválida';
      }
      queueBlockchainEvent({ type: eventType, message: summary, timestamp: Date.now() / 1000 });
    }
  }

  tickTimeSeries() {
    const rps = this.getRequestsPerSecond();
    const diff = this.getCurrentDifficulty();
    const timeStr = new Date().toLocaleTimeString('es-ES');
    this.timeSeries.push({
      time: timeStr,
      rps,
      difficulty: diff,
      verified: this.totalVerified,
      rejected: this.totalRejected
    });
    if (this.timeSeries.length > 30) {
      this.timeSeries.shift();
    }
  }

  markSignatureUsed(sig) {
    this.usedSignatures.add(sig);
  }

  isSignatureUsed(sig) {
    return this.usedSignatures.has(sig);
  }
}

const trafficManager = new TrafficManager();

// --- MOTOR DE PROOF-OF-WORK (STATELESS HMAC + VERIFICACIÓN O(1)) ---
class PoWEngine {
  /**
   * Genera un reto PoW sin estado firmado con HMAC
   * Formato: timestamp:clientId:difficulty:serverNonce:hmac
   */
  static generateChallenge(rawClientId = 'anon-client') {
    const timestamp = Date.now();
    const clientId = String(rawClientId).replace(/:/g, '_');
    const difficulty = trafficManager.getCurrentDifficulty();
    const serverNonce = crypto.randomBytes(8).toString('hex');
    const payload = `${timestamp}:${clientId}:${difficulty}:${serverNonce}`;
    const hmac = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
    return {
      challenge: `${payload}:${hmac}`,
      difficulty,
      expiresInSeconds: 60
    };
  }

  /**
   * Verifica la validez matemática y criptográfica del reto y nonce del cliente
   */
  static verify(challenge, clientNonce) {
    const startTime = process.hrtime.bigint();

    if (!challenge || !clientNonce) {
      return { valid: false, reason: 'Faltan cabeceras de reto (X-PoW-Challenge) o respuesta (X-PoW-Response).' };
    }

    const parts = challenge.split(':');
    if (parts.length !== 5) {
      return { valid: false, reason: 'Formato de reto PoW malformado o corrupto.' };
    }

    const [timestampStr, clientId, diffStr, serverNonce, hmacSignature] = parts;
    const timestamp = parseInt(timestampStr, 10);
    const difficulty = parseInt(diffStr, 10);

    if (isNaN(timestamp) || isNaN(difficulty)) {
      return { valid: false, reason: 'Valores numéricos de reto inválidos.' };
    }

    // 1. Verificación de expiración (Ventana de 60 segundos)
    if (Date.now() - timestamp > 60000) {
      return { valid: false, reason: 'El reto PoW ha expirado (> 60 segundos).' };
    }

    // 2. Verificación de Integridad HMAC
    const payload = `${timestampStr}:${clientId}:${diffStr}:${serverNonce}`;
    const expectedHmac = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');

    try {
      if (!crypto.timingSafeEqual(Buffer.from(hmacSignature), Buffer.from(expectedHmac))) {
        return { valid: false, reason: 'Firma HMAC inválida. El reto fue alterado por el cliente.' };
      }
    } catch (err) {
      return { valid: false, reason: 'Error en la verificación de firma criptográfica.' };
    }

    // 3. Prevención de Replay Attack (Token de uso único)
    const tokenId = `${hmacSignature}:${clientNonce}`;
    if (trafficManager.isSignatureUsed(tokenId)) {
      trafficManager.totalReplayPrevented++;
      return { valid: false, reason: 'Replay Attack detectado: Este reto y nonce ya fueron utilizados previamente.' };
    }

    // 4. Verificación de Colisión SHA-256
    const targetZeros = '0'.repeat(difficulty);
    const hash = crypto.createHash('sha256').update(challenge + clientNonce).digest('hex');

    const endTime = process.hrtime.bigint();
    const verifyTimeMs = Number(endTime - startTime) / 1e6;

    if (hash.startsWith(targetZeros)) {
      trafficManager.markSignatureUsed(tokenId);
      return {
        valid: true,
        hash,
        difficulty,
        verifyTimeMs,
        clientId
      };
    } else {
      return {
        valid: false,
        reason: `El hash generado (${hash.slice(0, 8)}...) no cumple la dificultad de ${difficulty} ceros iniciales.`,
        verifyTimeMs
      };
    }
  }
}

// --- SERVIDOR Y MANEJADOR DE RUTAS HTTP ---
const server = http.createServer((req, res) => {
  trafficManager.recordRequest();
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Cabeceras CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PoW-Challenge, X-PoW-Response, X-Client-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API 1: Solicitar Reto PoW
  if (req.method === 'GET' && pathname === '/api/pow/challenge') {
    const rawClient = parsedUrl.query.clientId || req.headers['x-client-id'] || 'client-' + req.socket.remoteAddress;
    const challengeData = PoWEngine.generateChallenge(rawClient);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(challengeData));
    return;
  }

  // API 2: Endpoint Sensible / Protegido con Middleware PoW
  if (req.method === 'POST' && pathname === '/api/heavy-report') {
    const challenge = req.headers['x-pow-challenge'];
    const clientNonce = req.headers['x-pow-response'];

    const verification = PoWEngine.verify(challenge, clientNonce);

    if (!verification.valid) {
      trafficManager.totalRejected++;
      trafficManager.logEvent('REJECTED', `Solicitud denegada: ${verification.reason}`);
      const newChallenge = PoWEngine.generateChallenge();

      res.writeHead(428, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-PoW-Required': 'true',
        'X-PoW-Reason': verification.reason
      });
      res.end(JSON.stringify({
        error: 'Proof-of-Work Requerido o Inválido',
        reason: verification.reason,
        nextChallenge: newChallenge
      }));
      return;
    }

    // PoW VÁLIDO -> HTTP 200 OK
    trafficManager.totalVerified++;
    trafficManager.logEvent('VERIFIED', `PoW Válido de ${verification.clientId} (Hash: ${verification.hash.slice(0, 10)}...)`);
    const procStart = Date.now();
    setTimeout(() => {
      const procTimeMs = Date.now() - procStart;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'Éxito',
        message: 'Acceso concedido a la API empresarial.',
        reportData: {
          reportId: 'REP-' + Math.floor(100000 + Math.random() * 900000),
          generatedAt: new Date().toISOString(),
          recordsProcessed: 45200,
          summary: 'Reporte consolidado verificado correctamente.'
        },
        powMetrics: {
          difficulty: verification.difficulty,
          hashMatched: verification.hash,
          serverVerifyTimeMs: parseFloat(verification.verifyTimeMs.toFixed(4)),
          serverProcessingTimeMs: procTimeMs
        }
      }));
    }, 40);
    return;
  }

  // API 3: Telemetría y Métricas en Tiempo Real
  if (req.method === 'GET' && pathname === '/api/blockchain') {
    const state = readBlockchainState();
    state.mining = blockchainMining;
    state.lastError = blockchainLastError;
    state.droppedEvents = blockchainDroppedEvents;
    const blocks = state.chain || [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      valid: state.valid !== false,
      mining: state.mining,
      queuedEvents: state.queuedEvents,
      droppedEvents: state.droppedEvents,
      lastError: state.lastError,
      difficultyBits: state.difficulty_bits || Number(process.env.BLOCKCHAIN_EVENT_DIFFICULTY_BITS || 10),
      blockCount: blocks.length,
      blocks: blocks.slice().reverse().map(block => ({
        index: block.index, hash: block.hash, previousHash: block.previous_hash,
        transactions: (block.transactions || []).map(tx => tx.metadata || { kind: tx.kind }),
        difficultyBits: block.difficulty_bits, nonce: block.nonce
      }))
    }));
    return;
  }

  // API 4: Telemetría y Métricas en Tiempo Real
  if (req.method === 'GET' && pathname === '/api/metrics') {
    trafficManager.tickTimeSeries();
    const totalReqs = trafficManager.totalVerified + trafficManager.totalRejected;
    const rejectedPct = totalReqs > 0 ? parseFloat(((trafficManager.totalRejected / totalReqs) * 100).toFixed(1)) : 0.0;
    const cpuSavedPct = totalReqs > 0 ? parseFloat(((trafficManager.totalRejected / Math.max(1, totalReqs)) * 98.5).toFixed(1)) : 0.0;

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      requestsPerSecond: trafficManager.getRequestsPerSecond(),
      currentDifficulty: trafficManager.getCurrentDifficulty(),
      isManualDifficulty: trafficManager.manualDifficulty !== null,
      totalVerified: trafficManager.totalVerified,
      totalRejected: trafficManager.totalRejected,
      totalReplayPrevented: trafficManager.totalReplayPrevented,
      rejectedPct,
      cpuSavedPct,
      eventLogs: trafficManager.eventLogs,
      timeSeries: trafficManager.timeSeries,
      uptimeSeconds: Math.floor((Date.now() - trafficManager.startTime) / 1000)
    }));
    return;
  }

  // API 4: Cambiar Dificultad Manualmente (Admin Demo)
  if (req.method === 'POST' && pathname === '/api/admin/difficulty') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        trafficManager.setManualDifficulty(data.difficulty);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          newDifficulty: trafficManager.getCurrentDifficulty(),
          isManual: trafficManager.manualDifficulty !== null
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'JSON malformado' }));
      }
    });
    return;
  }

  // API 5: Ejecución de Benchmark Criptográfico con Módulos de Python
  if (req.method === 'POST' && pathname === '/api/benchmark/run') {
    trafficManager.logEvent('BENCHMARK', 'Iniciando suite de pruebas criptográficas de PoW en Python...');

    // Registrar la actividad real del servidor mientras Python ejecuta el benchmark.
    const startedAt = new Date().toISOString();
    const baseline = {
      requests: trafficManager.totalRequests,
      verified: trafficManager.totalVerified,
      rejected: trafficManager.totalRejected,
      replayPrevented: trafficManager.totalReplayPrevented
    };
    const activitySamples = [];
    const captureActivity = () => {
      activitySamples.push({
        time: new Date().toISOString(),
        requestsPerSecond: trafficManager.getRequestsPerSecond(),
        difficulty: trafficManager.getCurrentDifficulty(),
        verified: trafficManager.totalVerified,
        rejected: trafficManager.totalRejected,
        replayPrevented: trafficManager.totalReplayPrevented
      });
    };
    captureActivity();
    const activityTimer = setInterval(captureActivity, 500);

    // Primero medir PoW en Python; después incorporar la actividad capturada al informe.
    exec('python3 run_benchmark.py', { cwd: __dirname }, (error, stdout, stderr) => {
      clearInterval(activityTimer);
      captureActivity();

      if (error) {
        trafficManager.logEvent('BENCHMARK_FAILED', 'El benchmark no pudo completarse.');
        console.error(`Error ejecutando benchmark Python: ${stderr || error.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: stderr || error.message }));
        return;
      }

      const finishedAt = new Date().toISOString();
      const activityDuringRun = {
        startedAt,
        finishedAt,
        durationSeconds: Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 100) / 10,
        requestsObserved: trafficManager.totalRequests - baseline.requests,
        verifiedPoWs: trafficManager.totalVerified - baseline.verified,
        rejectedRequests: trafficManager.totalRejected - baseline.rejected,
        replayAttempts: trafficManager.totalReplayPrevented - baseline.replayPrevented,
        peakRequestsPerSecond: Math.max(0, ...activitySamples.map(sample => sample.requestsPerSecond)),
        difficultiesObserved: [...new Set(activitySamples.map(sample => sample.difficulty))],
        samples: activitySamples
      };
      fs.writeFileSync(
        path.join(__dirname, 'pow_benchmark_activity.json'),
        JSON.stringify(activityDuringRun, null, 2),
        'utf-8'
      );

      exec('python3 plot_benchmark.py', { cwd: __dirname }, (plotError, plotStdout, plotStderr) => {
        if (plotError) {
          console.error(`Error generando gráfica del benchmark: ${plotStderr || plotError.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: plotStderr || plotError.message }));
          return;
        }

        const jsonPath = path.join(__dirname, 'pow_benchmark_results.json');
        let resultsJson = {};
        if (fs.existsSync(jsonPath)) {
          try {
            resultsJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
          } catch (e) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        trafficManager.logEvent('BENCHMARK_COMPLETE', 'El benchmark criptográfico terminó correctamente.');
        res.end(JSON.stringify({
          success: true,
          message: 'Benchmark PoW ejecutado; actividad real del servidor capturada durante la medición.',
          data: resultsJson,
          activityDuringRun,
          activityUrl: '/api/benchmark/activity',
          csvUrl: '/api/benchmark/csv',
          chartUrl: `/pow_performance_benchmark.png?t=${Date.now()}`
        }));
      });
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/benchmark/activity') {
    const activityPath = path.join(__dirname, 'pow_benchmark_activity.json');
    if (fs.existsSync(activityPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(fs.readFileSync(activityPath, 'utf-8'));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Todavía no se ha ejecutado un benchmark.' }));
    }
    return;
  }

  // API 6: Descargar CSV de Benchmark
  if (req.method === 'GET' && pathname === '/api/benchmark/csv') {
    const csvPath = path.join(__dirname, 'pow_benchmark_results.csv');
    if (fs.existsSync(csvPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="pow_benchmark_results.csv"'
      });
      fs.createReadStream(csvPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Archivo CSV no encontrado.' }));
    }
    return;
  }

  // SERVIDOR DE ARCHIVOS ESTÁTICOS (FRONTEND PUBLIC)
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    // Si se solicita algo como /pow_performance_benchmark.png en la raíz
    filePath = path.join(__dirname, pathname.lstrip ? pathname.lstrip('/') : pathname.replace(/^\//, ''));
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.csv': 'text/csv; charset=utf-8',
    '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 Recurso No Encontrado</h1>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('Error interno del servidor: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Servidor PoW Rate Limiter v7 (Node.js High-Fluidity I/O)`);
  console.log(` Motor Criptográfico & Benchmarks: Python 3.12 + Matplotlib`);
  console.log(` Dashboard UI disponible en: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
