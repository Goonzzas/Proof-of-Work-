"""FastAPI backend for the shared Vercel + Supabase PoW demonstration."""
from __future__ import annotations

import base64
import copy
import csv
import io
import json
import os
import statistics
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from dask.distributed import Client, LocalCluster
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response

from blockchain_pow import Block, mine_distributed, mine_sequential
from pow_crypto import (calculate_asymmetry_ratio, generate_pow_challenge,
                        solve_pow, verify_pow)


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
ROOT = Path(__file__).resolve().parent
DIFFICULTIES = (10, 12)
WORKER_COUNTS = (1, 2, 4)
REPEATS = 3
BATCH_SIZE = 20_000

app = FastAPI(title="Proof-of-Work Rate Limiter", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "OPTIONS"],
                   allow_headers=["Content-Type", "X-PoW-Challenge", "X-PoW-Response", "X-Client-ID"])


def rpc(name: str, payload: dict | None = None):
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY en Vercel.")
    request = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{name}",
        data=json.dumps(payload or {}).encode("utf-8"),
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {error.code}: {details[:600]}") from error


@app.get("/api/pow/challenge")
def issue_challenge(request: Request):
    client_id = request.query_params.get("clientId") or request.headers.get("x-client-id") or "anon-client"
    return rpc("pow_issue_challenge", {"p_client_id": client_id})


@app.post("/api/heavy-report")
def heavy_report(request: Request):
    result = rpc("pow_verify_challenge", {
        "p_challenge": request.headers.get("x-pow-challenge"),
        "p_client_nonce": request.headers.get("x-pow-response")})
    if not result.get("valid"):
        next_challenge = rpc("pow_issue_challenge", {"p_client_id": "anon-client"})
        return JSONResponse(status_code=428, headers={"X-PoW-Required": "true"}, content={
            "error": "Proof-of-Work Requerido o Inválido", "reason": result.get("reason"),
            "nextChallenge": next_challenge})
    return {"status": "Éxito", "message": "Acceso concedido a la API compartida.",
        "reportData": {"reportId": f"REP-{int(time.time() * 1000) % 900000 + 100000}",
          "generatedAt": datetime.now(timezone.utc).isoformat(), "recordsProcessed": 45200,
          "summary": "Reporte consolidado verificado correctamente."},
        "powMetrics": {"difficulty": result.get("difficulty"), "hashMatched": result.get("hash"),
          "serverVerifyTimeMs": 0, "serverProcessingTimeMs": 0}}


@app.get("/api/metrics")
def metrics():
    return rpc("pow_get_metrics")


@app.get("/api/blockchain")
def blockchain():
    return rpc("pow_get_blockchain")


@app.post("/api/admin/difficulty")
async def set_difficulty(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    return rpc("pow_set_difficulty", {"p_difficulty": str(data.get("difficulty", "auto"))})


@app.post("/api/benchmark/run")
def run_crypto_benchmark():
    bits_list, repeats = (12, 14, 16), 3
    results = []
    for bits in bits_list:
        client_times, server_times, hashes = [], [], []
        for _ in range(repeats):
            challenge = generate_pow_challenge("vercel-benchmark", bits // 4)
            solved = solve_pow(challenge, bits)
            verified = verify_pow(challenge, solved["nonce"], bits)
            client_times.append(solved["timeMs"])
            server_times.append(verified["verifyMs"])
            hashes.append(solved["hashesTested"])
        client_ms = round(statistics.mean(client_times), 2)
        server_ms = round(statistics.mean(server_times), 4)
        results.append({"bits": bits, "hexZeros": bits // 4, "expectedHashes": 2 ** bits,
            "avgHashes": round(statistics.mean(hashes)), "avgClientMs": client_ms,
            "avgServerMs": server_ms, "hashRate": round(sum(hashes) / max(sum(client_times) / 1000, 1e-9)),
            "asymmetryRatio": int(calculate_asymmetry_ratio(client_ms, server_ms))})
    figure, axes = plt.subplots(1, 2, figsize=(10, 4), dpi=110)
    bits = [row["bits"] for row in results]
    axes[0].plot(bits, [row["avgClientMs"] for row in results], "o-", label="Minado cliente")
    axes[0].plot(bits, [row["avgServerMs"] for row in results], "s--", label="Verificación servidor")
    axes[0].set_yscale("log"); axes[0].set_xlabel("Dificultad (bits)"); axes[0].set_ylabel("Tiempo (ms)"); axes[0].legend()
    axes[1].bar([str(bit) for bit in bits], [row["asymmetryRatio"] for row in results])
    axes[1].set_xlabel("Dificultad (bits)"); axes[1].set_ylabel("Relación de asimetría")
    figure.tight_layout()
    image = io.BytesIO(); figure.savefig(image, format="png", bbox_inches="tight"); plt.close(figure)
    chart = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode("ascii")
    return {"success": True, "message": "Benchmark SHA-256 ejecutado en Python dentro de Vercel.",
            "data": results, "chartUrl": chart}


def summarize(times: list[float]) -> dict[str, float]:
    return {"median_seconds": round(statistics.median(times), 6),
            "mean_seconds": round(statistics.mean(times), 6),
            "min_seconds": round(min(times), 6), "max_seconds": round(max(times), 6)}


@app.get("/api/benchmark/distributed/status")
def dask_status():
    state = rpc("pow_benchmark_get")
    if state.get("results"):
        state["results"]["description"] = "Dask con workers de hilos dentro de una función Python de Vercel."
    return state


@app.post("/api/benchmark/distributed/run")
def run_dask_benchmark():
    run = rpc("pow_benchmark_start")
    if not run.get("success"):
        return JSONResponse(status_code=409, content=run)
    run_id = run["runId"]
    results: list[dict] = []
    try:
        rpc("pow_benchmark_update", {"p_run_id": run_id, "p_results": [], "p_completed": 0,
            "p_running": True, "p_error": None})
        # Serverless functions cannot reliably spawn child processes. Dask
        # still schedules independent nonce ranges across in-process workers.
        cluster = LocalCluster(n_workers=max(WORKER_COUNTS), threads_per_worker=1,
                               processes=False, dashboard_address=None, host="127.0.0.1")
        client = Client(cluster)
        try:
            for bits in DIFFICULTIES:
                templates = [Block(1, "0" * 64,
                    [{"experiment": repeat, "nonce_seed": f"{bits}-{repeat}"}], bits)
                    for repeat in range(REPEATS)]
                sequential = summarize([mine_sequential(copy.deepcopy(block))["elapsed_seconds"]
                                        for block in templates])
                for workers in WORKER_COUNTS:
                    times, rates, proofs_valid = [], [], True
                    for template in templates:
                        block = copy.deepcopy(template)
                        measured = mine_distributed(block, workers=workers, batch_size=BATCH_SIZE, client=client)
                        times.append(measured["elapsed_seconds"]); rates.append(measured["hash_rate"])
                        proofs_valid = proofs_valid and block.valid_proof()
                    distributed = summarize(times)
                    speedup = sequential["median_seconds"] / max(distributed["median_seconds"], 1e-9)
                    results.append({"difficulty_bits": bits, "workers": workers, "repeats": REPEATS,
                        "batch_size": BATCH_SIZE, "sequential_median_seconds": sequential["median_seconds"],
                        "distributed_median_seconds": distributed["median_seconds"],
                        "distributed_mean_seconds": distributed["mean_seconds"],
                        "distributed_min_seconds": distributed["min_seconds"],
                        "distributed_max_seconds": distributed["max_seconds"],
                        "mean_distributed_hash_rate": round(statistics.mean(rates), 2),
                        "speedup_vs_sequential": round(speedup, 3),
                        "parallel_efficiency": round(speedup / workers, 3), "all_proofs_valid": proofs_valid})
                    rpc("pow_benchmark_update", {"p_run_id": run_id, "p_results": results,
                        "p_completed": len(results), "p_running": True, "p_error": None})
        finally:
            client.close(); cluster.close()
        rpc("pow_benchmark_update", {"p_run_id": run_id, "p_results": results,
            "p_completed": len(results), "p_running": False, "p_error": None})
        return {"success": True, "started": True, "message": "Benchmark Dask completado y compartido en Supabase."}
    except Exception as error:
        try:
            rpc("pow_benchmark_update", {"p_run_id": run_id, "p_results": results,
                "p_completed": len(results), "p_running": False, "p_error": str(error)[:1000]})
        except Exception:
            pass
        return JSONResponse(status_code=500, content={"success": False, "error": str(error)[:1000]})


@app.get("/api/benchmark/distributed.csv")
def dask_csv():
    state = rpc("pow_benchmark_get")
    rows = (state.get("results") or {}).get("results") or []
    if not rows:
        return JSONResponse(status_code=404, content={"error": "Todavía no hay resultados del benchmark Dask."})
    buffer = io.StringIO(); writer = csv.DictWriter(buffer, fieldnames=rows[0].keys())
    writer.writeheader(); writer.writerows(rows)
    return Response(buffer.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=pow_distributed_benchmark.csv"})


@app.get("/api/benchmark/csv")
def benchmark_csv():
    return RedirectResponse("/pow_benchmark_results.csv", status_code=307)


@app.get("/api/benchmark/activity")
def benchmark_activity():
    path = ROOT / "pow_benchmark_activity.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return JSONResponse(status_code=404, content={"error": "Todavía no se ha ejecutado un benchmark."})


@app.get("/api/benchmark/status")
def benchmark_status():
    return {"running": False, "results": None}


# Vercel serves the dashboard from outputDirectory; this ASGI app owns API routes.
