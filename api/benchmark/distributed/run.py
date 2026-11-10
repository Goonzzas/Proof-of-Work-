"""Runs the Dask comparison on Vercel and saves each completed row in Supabase."""
from __future__ import annotations

import copy
import json
import os
import statistics
import urllib.request
from http.server import BaseHTTPRequestHandler

from dask.distributed import Client, LocalCluster

from blockchain_pow import Block, mine_distributed, mine_sequential

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
DIFFICULTIES = (10, 12)
WORKER_COUNTS = (1, 2, 4)
REPEATS = 3
BATCH_SIZE = 20_000


def rpc(name: str, payload: dict) -> object:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Faltan variables de conexión con Supabase en Vercel.")
    request = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{name}", data=json.dumps(payload).encode("utf-8"),
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def summarize(times: list[float]) -> dict[str, float]:
    return {"median_seconds": round(statistics.median(times), 6),
            "mean_seconds": round(statistics.mean(times), 6),
            "min_seconds": round(min(times), 6), "max_seconds": round(max(times), 6)}


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # Vercel Python runtime entry point
        run = None
        results: list[dict] = []
        try:
            run = rpc("pow_benchmark_start", {})
            if not run.get("success"):
                return self.reply(409, run)
            run_id = run["runId"]
            rpc("pow_benchmark_update", {"p_run_id": run_id, "p_results": [],
                "p_completed": 0, "p_running": True, "p_error": None})

            cluster = LocalCluster(n_workers=max(WORKER_COUNTS), threads_per_worker=1,
                                   processes=True, dashboard_address=None, host="127.0.0.1")
            client = Client(cluster)
            try:
                for bits in DIFFICULTIES:
                    templates = [Block(1, "0" * 64,
                        [{"experiment": repeat, "nonce_seed": f"{bits}-{repeat}"}], bits)
                        for repeat in range(REPEATS)]
                    sequential = summarize([mine_sequential(copy.deepcopy(block))["elapsed_seconds"]
                                            for block in templates])
                    for workers in WORKER_COUNTS:
                        durations, rates, proofs_valid = [], [], True
                        for template in templates:
                            block = copy.deepcopy(template)
                            measured = mine_distributed(block, workers=workers,
                                batch_size=BATCH_SIZE, client=client)
                            durations.append(measured["elapsed_seconds"])
                            rates.append(measured["hash_rate"])
                            proofs_valid = proofs_valid and block.valid_proof()
                        distributed = summarize(durations)
                        speedup = sequential["median_seconds"] / max(distributed["median_seconds"], 1e-9)
                        results.append({"difficulty_bits": bits, "workers": workers,
                            "repeats": REPEATS, "batch_size": BATCH_SIZE,
                            "sequential_median_seconds": sequential["median_seconds"],
                            "distributed_median_seconds": distributed["median_seconds"],
                            "distributed_mean_seconds": distributed["mean_seconds"],
                            "distributed_min_seconds": distributed["min_seconds"],
                            "distributed_max_seconds": distributed["max_seconds"],
                            "mean_distributed_hash_rate": round(statistics.mean(rates), 2),
                            "speedup_vs_sequential": round(speedup, 3),
                            "parallel_efficiency": round(speedup / workers, 3),
                            "all_proofs_valid": proofs_valid})
                        # Each update is immediately visible to all dashboard viewers.
                        rpc("pow_benchmark_update", {"p_run_id": run_id,
                            "p_results": results, "p_completed": len(results),
                            "p_running": True, "p_error": None})
            finally:
                client.close()
                cluster.close()
            rpc("pow_benchmark_update", {"p_run_id": run_id, "p_results": results,
                "p_completed": len(results), "p_running": False, "p_error": None})
            return self.reply(200, {"success": True, "started": True,
                "message": "Benchmark Dask completado y compartido en Supabase.", "results": results})
        except Exception as error:
            if run and run.get("runId"):
                try:
                    rpc("pow_benchmark_update", {"p_run_id": run["runId"],
                        "p_results": results, "p_completed": len(results),
                        "p_running": False, "p_error": str(error)[:1000]})
                except Exception:
                    pass
            return self.reply(500, {"success": False, "error": str(error)[:1000]})

    def reply(self, status: int, data: dict) -> None:
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt: str, *args: object) -> None:
        print(fmt % args)
