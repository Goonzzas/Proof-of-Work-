/**
 * Minero PoW en Web Worker.
 * Prueba lotes de SHA-256 con Web Crypto para evitar esperar cada hash por separado.
 */

self.onmessage = async function (event) {
  const { challenge, difficulty } = event.data;
  const targetZeros = Number(difficulty);

  if (!Number.isInteger(targetZeros) || targetZeros < 1 || targetZeros > 64) {
    self.postMessage({ type: 'ERROR', message: 'Dificultad PoW inválida.' });
    return;
  }

  const encoder = new TextEncoder();
  const batchSize = 64;
  const fullZeroBytes = Math.floor(targetZeros / 2);
  const hasZeroNibble = targetZeros % 2 === 1;
  let nextNonce = 0;
  let hashesTested = 0;
  const startTime = performance.now();
  let lastReportTime = startTime;

  function hasRequiredPrefix(bytes) {
    for (let i = 0; i < fullZeroBytes; i++) {
      if (bytes[i] !== 0) return false;
    }
    return !hasZeroNibble || (bytes[fullZeroBytes] & 0xf0) === 0;
  }

  function toHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  try {
    while (true) {
      const batchStart = nextNonce;
      const hashes = await Promise.all(
        Array.from({ length: batchSize }, (_, offset) => {
          const nonce = batchStart + offset;
          const input = encoder.encode(challenge + nonce.toString());
          return crypto.subtle.digest('SHA-256', input).then(digest => ({
            nonce,
            bytes: new Uint8Array(digest)
          }));
        })
      );

      // Revisar en orden para aceptar el primer nonce válido del lote.
      for (const result of hashes) {
        hashesTested++;
        if (hasRequiredPrefix(result.bytes)) {
          const elapsedMs = Math.round(performance.now() - startTime);
          self.postMessage({
            type: 'SUCCESS',
            nonce: result.nonce.toString(),
            hash: toHex(result.bytes),
            totalTimeMs: elapsedMs,
            totalHashes: hashesTested
          });
          return;
        }
      }

      nextNonce += batchSize;
      const now = performance.now();
      if (now - lastReportTime >= 100) {
        const elapsedMs = Math.round(now - startTime);
        self.postMessage({
          type: 'PROGRESS',
          hashesTested,
          hashRate: Math.round(hashesTested / (elapsedMs / 1000 || 0.001)),
          elapsedMs
        });
        lastReportTime = now;
      }

      // Deja que el worker procese otros mensajes y mantenga el progreso visible.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      message: `No se pudo calcular SHA-256: ${error.message}`
    });
  }
};
