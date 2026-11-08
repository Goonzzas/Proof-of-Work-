/**
 * pow-worker.js - Web Worker en JavaScript para Minado SHA-256 en Segundo Plano
 * Ejecuta la búsqueda del nonce de Hashcash sin congelar la UI del navegador.
 */

self.onmessage = async function(e) {
  const { challenge, difficulty } = e.data;
  const targetPrefix = '0'.repeat(difficulty);

  let nonce = 0;
  const startTime = performance.now();
  let lastReportTime = startTime;

  // Codificador UTF-8 nativo
  const encoder = new TextEncoder();

  while (true) {
    const inputStr = challenge + nonce.toString();
    const data = encoder.encode(inputStr);
    
    // Hash SHA-256 nativo mediante Web Crypto API (SubtleCrypto)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const now = performance.now();

    // Notificar progreso periódicamente cada 100ms
    if (now - lastReportTime > 100) {
      const elapsedMs = Math.round(now - startTime);
      const hashRate = Math.round((nonce + 1) / (elapsedMs / 1000 || 0.001));
      self.postMessage({
        type: 'PROGRESS',
        hashesTested: nonce + 1,
        hashRate,
        elapsedMs
      });
      lastReportTime = now;
    }

    // Comprobar coincidencia del prefijo de ceros
    if (hashHex.startsWith(targetPrefix)) {
      const totalTimeMs = Math.round(now - startTime);
      self.postMessage({
        type: 'SUCCESS',
        nonce: nonce.toString(),
        hash: hashHex,
        totalTimeMs,
        totalHashes: nonce + 1
      });
      break;
    }

    nonce++;
  }
};
