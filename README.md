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
