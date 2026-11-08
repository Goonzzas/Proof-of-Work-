/**
 * test_e2e.js - Prueba de Integración End-to-End (E2E) en Node.js
 */

const http = require('http');
const crypto = require('crypto');

function makeRequest(urlOptions, postData = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(urlOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTest() {
  console.log('=== PRUEBA DE INTEGRACIÓN E2E EN NODE.JS ===\n');

  console.log('1. Solicitando reto a GET /api/pow/challenge...');
  const challengeRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/pow/challenge?clientId=node-e2e-tester',
    method: 'GET'
  });

  const { challenge, difficulty } = challengeRes.body;
  console.log(`Reto recibido: Dificultad = ${difficulty} ceros hex (${difficulty * 4} bits)`);

  console.log('2. Minando solución en JS (encontrando nonce)...');
  const start = Date.now();
  let nonce = 0;
  const target = '0'.repeat(difficulty);
  let hash = '';

  while (true) {
    const testHash = crypto.createHash('sha256').update(challenge + nonce.toString()).digest('hex');
    if (testHash.startsWith(target)) {
      hash = testHash;
      break;
    }
    nonce++;
  }
  const solveMs = Date.now() - start;
  console.log(`Solución encontrada en ${solveMs}ms! Nonce: ${nonce}, Hash: ${hash}`);

  console.log('3. Enviando respuesta a POST /api/heavy-report...');
  const apiRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/heavy-report',
    method: 'POST',
    headers: {
      'X-PoW-Challenge': challenge,
      'X-PoW-Response': nonce.toString()
    }
  });

  console.log('Respuesta del servidor (HTTP ' + apiRes.statusCode + '):');
  console.log(JSON.stringify(apiRes.body, null, 2));

  console.log('\n4. Probando prevención de Replay Attack (reusando el mismo nonce)...');
  const replayRes = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/heavy-report',
    method: 'POST',
    headers: {
      'X-PoW-Challenge': challenge,
      'X-PoW-Response': nonce.toString()
    }
  });

  console.log('Respuesta ante Replay (HTTP ' + replayRes.statusCode + '):');
  console.log(JSON.stringify(replayRes.body, null, 2));
}

runTest().catch((err) => {
  console.log('Nota: El servidor debe estar en ejecución para completar la prueba HTTP. Error:', err.message);
});
