# Sistema de Rate Limiting y Anti-DDoS basado en Proof-of-Work (Hashcash) — v7

## 📌 Arquitectura Híbrida de Alta Fluidez y Rendimiento

La **Versión 7** del proyecto combina la fluidez I/O no bloqueante de **Node.js** con el poder de análisis criptográfico y generación de gráficos de **Python 3.12**:

1. **Servidor HTTP & Gateway API (`server.js` - Node.js):**
   - Manejo asíncrono y ultra-fluido de solicitudes HTTP sin bloqueo de hilos.
   - Interceptación middleware stateless HMAC en $O(1)$ con prevención de ataques de repetición (*Replay Attacks*).
   - Servidor estático para la interfaz de usuario Dashboard y telemetría en tiempo real.
   - Autotuning dinámico de dificultad según la carga de peticiones por segundo (RPS).

2. **Motor Criptográfico & Benchmarking (`pow_crypto.py`, `run_benchmark.py`, `plot_benchmark.py` - Python 3.12):**
   - Módulo en Python dedicado a las funciones Hash SHA-256, la búsqueda de preimagen de Hashcash y la medición de la asimetría criptográfica $O(2^k)$ vs $O(1)$.
   - Suite de evaluación de rendimiento y exportación automática a **CSV** (`pow_benchmark_results.csv`) y **JSON**.
   - Generación de gráficos analíticos profesionales con **Matplotlib** (`pow_performance_benchmark.png`).

---

## 🚀 Guía de Instalación y Ejecución en Linux

### 1. Iniciar el Servidor Principal en Node.js
```bash
npm start
# o directamente: node server.js
```
El dashboard estará disponible en: **`http://localhost:3000`**

### 2. Ejecutar la Suite Criptográfica y Benchmark en Python
Desde otra consola de terminal (o utilizando el botón en el Dashboard web):
```bash
npm run benchmark
# o directamente: python3 run_benchmark.py && python3 plot_benchmark.py
```
Esto calculará la penalización de CPU para dificultades de 12 a 22 bits, actualizará la tabla CSV y generará las infografías de Matplotlib.

### 3. Pruebas de Integración End-to-End (E2E)
```bash
npm test
# Ejecuta tanto test_e2e.js como test_e2e.py
```

---

## 🛡️ Estructura del Proyecto

* **`server.js`**: Servidor web HTTP en Node.js (Middleware, APIs, CORS, Replay Protection, Static Files).
* **`pow_crypto.py`**: Funciones Hash y algoritmos Proof-of-Work en Python.
* **`run_benchmark.py`**: Script de pruebas criptográficas masivas en Python.
* **`plot_benchmark.py`**: Generador de gráficas de asimetría en Python (Matplotlib).
* **`public/index.html`**: Dashboard UI empresarial con monitoreo en tiempo real.
* **`public/app.js`**: Controlador frontend de cliente.
* **`public/pow-worker.js`**: Web Worker en JS para minado en segundo plano en el cliente.
* **`test_e2e.js` / `test_e2e.py`**: Scripts de prueba automatizada End-to-End.

---

## Extensión académica: blockchain y PoW distribuido

El proyecto original protege una API con Hashcash. Esta extensión incorpora una
segunda demo independiente para los temas de la consigna: bloques enlazados,
Merkle root, transacciones firmadas, validación de cadena, elección por trabajo
acumulado, consenso bizantino OM(m) y minería paralela local con Dask.

### Instalación y ejecución

```bash
python3 -m pip install -r requirements-distributed.txt
python3 blockchain_demo.py --difficulty 12 --workers 1
python3 blockchain_demo.py --difficulty 16 --workers 4
python3 byzantine_consensus.py
python3 run_distributed_benchmark.py
```

La dificultad se expresa en bits iniciales en cero, no en caracteres hexadecimales.
`--workers 1` usa búsqueda secuencial; más workers reparte intervalos de nonce
no solapados entre procesos Dask. El benchmark crea el cluster una vez, lo excluye
del cronómetro y registra tiempos, hash rate, aceleración, eficiencia y validez
de la prueba en `pow_distributed_benchmark.csv` y `.json`.

### Componentes añadidos

| Archivo | Función |
|---|---|
| `blockchain_pow.py` | Transacciones Ed25519, raíz Merkle, bloques SHA-256, validación de PoW, cadena y selección por trabajo acumulado; minado secuencial y Dask. |
| `blockchain_demo.py` | Demo de extremo a extremo: genera claves, firma una transacción, mina, valida y exporta un bloque. |
| `byzantine_consensus.py` | Simulación del algoritmo de mensajes orales OM(m), incluida una política de entrega para representar equivocación bizantina. |
| `run_distributed_benchmark.py` | Comparación repetida de minado secuencial y paralelo, con CSV/JSON y métricas de escalabilidad. |
| `requirements-distributed.txt` | Dependencias Python de la extensión. |

### Conexión del dashboard con la blockchain

El servidor registra en una blockchain local las solicitudes aceptadas y
rechazadas, los intentos de repetición, los cambios manuales de dificultad y
la ejecución del benchmark. Los eventos se agrupan durante unos instantes y
se minan en segundo plano para que la respuesta HTTP no tenga que esperar a la
minería. La cadena persiste en `data/blockchain_events.json`; el dashboard
muestra cada evento dentro de los últimos bloques y el endpoint entrega el
historial completo.

Para activar el puente Python, crea y usa el entorno virtual recomendado en
Linux e instala las dependencias:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-distributed.txt
npm start
```

En el dashboard, prueba **«Seguro»**, **«Sin PoW»**, **«Replay Attack»** y el
selector de dificultad; sus eventos aparecerán en la tarjeta
**«Blockchain de solicitudes verificadas»**. También puedes abrir
`http://localhost:3000/api/blockchain` para ver el JSON con el estado, los
bloques recientes y los eventos incluidos. La cadena usa 10 bits por defecto;
puedes cambiarlo con `BLOCKCHAIN_EVENT_DIFFICULTY_BITS` antes de iniciar el
servidor. Estos bloques son una demostración local: no son una red pública y no
registran datos personales del cliente.

### Qué demuestra y qué no

La demo construye una cadena local y ejecuta tareas paralelas en varios procesos
de una máquina (o en un scheduler Dask remoto si se integra uno). No implementa
una red P2P de blockchain, propagación de transacciones/bloques por sockets,
recompensas/moneda, ni almacenamiento persistente de una red. OM(m) se simula en
memoria y sirve para enseñar el supuesto de nodos bizantinos y el límite clásico
`n >= 3m + 1`; no se usa como protocolo para validar la cadena PoW. En una
blockchain abierta, PoW selecciona probabilísticamente qué historial gana por
trabajo acumulado; esa idea está relacionada con la tolerancia a fallos, pero no
equivale a ejecutar OM(m).

La clave Ed25519 generada en la demo solo vive en el proceso y es para mostrar
firmas; no se debe usar para administrar fondos reales. El benchmark es una
experiencia de aula, sensible a la CPU, versiones, carga y dificultad. Para
comparaciones justas hay que ejecutar varias repeticiones y reportar el equipo.
bloques y los eventos incluidos. La cola descarta eventos nuevos si supera
500 pendientes, y muestra el total omitido para proteger la demo durante una
carga masiva.
