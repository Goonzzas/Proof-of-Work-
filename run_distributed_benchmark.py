#!/usr/bin/env python3
"""Compare sequential SHA-256 mining with Dask workers on one machine."""

from __future__ import annotations

import csv
import copy
import json
import os
import platform
import statistics
import time
from pathlib import Path

from dask.distributed import Client, LocalCluster

from blockchain_pow import Block, mine_distributed, mine_sequential


DIFFICULTIES = [12, 14, 16]
WORKER_COUNTS = [1, 2, 4]
REPEATS = 7
BATCH_SIZE = 20_000


def summarize(times: list[float]) -> dict[str, float]:
    return {"median_seconds": round(statistics.median(times), 6),
            "mean_seconds": round(statistics.mean(times), 6),
            "min_seconds": round(min(times), 6),
            "max_seconds": round(max(times), 6)}


def write_progress(base: Path, measurements: list[dict], running: bool) -> None:
    total = len(DIFFICULTIES) * len(WORKER_COUNTS)
    payload = {
        "description": "Dask local-process benchmark; includes mining task coordination, excludes cluster startup",
        "running": running,
        "completed": len(measurements),
        "total": total,
        "updated_at": time.time(),
        "environment": {"python": platform.python_version(), "platform": platform.platform(),
                        "cpu_count": os.cpu_count()},
        "parameters": {"difficulties_bits": DIFFICULTIES, "workers": WORKER_COUNTS,
                       "repeats": REPEATS, "batch_size": BATCH_SIZE},
        "results": measurements,
    }
    progress_path = base / "pow_distributed_benchmark_progress.json"
    temporary_path = progress_path.with_suffix(".json.tmp")
    temporary_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temporary_path.replace(progress_path)


def main() -> None:
    base = Path(__file__).resolve().parent
    measurements: list[dict] = []
    write_progress(base, measurements, running=True)
    cluster = LocalCluster(n_workers=max(WORKER_COUNTS), threads_per_worker=1,
                           processes=True, dashboard_address=None)
    client = Client(cluster)
    try:
        for bits in DIFFICULTIES:
            # Each serial/Dask pair receives the exact same header so the
            # candidate search itself is comparable, not just the difficulty.
            templates = [Block(1, "0" * 64,
                               [{"experiment": run, "nonce_seed": f"{bits}-{run}"}], bits)
                         for run in range(REPEATS)]
            serial_times: list[float] = []
            for template in templates:
                block = copy.deepcopy(template)
                result = mine_sequential(block)
                serial_times.append(result["elapsed_seconds"])
            serial = summarize(serial_times)
            for workers in WORKER_COUNTS:
                times: list[float] = []
                rates: list[float] = []
                valid = True
                for template in templates:
                    block = copy.deepcopy(template)
                    result = mine_distributed(block, workers=workers,
                                              batch_size=BATCH_SIZE, client=client)
                    times.append(result["elapsed_seconds"])
                    rates.append(result["hash_rate"])
                    valid = valid and block.valid_proof()
                distributed = summarize(times)
                speedup = serial["median_seconds"] / distributed["median_seconds"]
                measurements.append({
                    "difficulty_bits": bits,
                    "workers": workers,
                    "repeats": REPEATS,
                    "batch_size": BATCH_SIZE,
                    "sequential_median_seconds": serial["median_seconds"],
                    "distributed_median_seconds": distributed["median_seconds"],
                    "distributed_mean_seconds": distributed["mean_seconds"],
                    "distributed_min_seconds": distributed["min_seconds"],
                    "distributed_max_seconds": distributed["max_seconds"],
                    "mean_distributed_hash_rate": round(statistics.mean(rates), 2),
                    "speedup_vs_sequential": round(speedup, 3),
                    "parallel_efficiency": round(speedup / workers, 3),
                    "all_proofs_valid": valid,
                })
                write_progress(base, measurements, running=True)
                print(f"{bits:2} bits | {workers} workers | serial {serial['median_seconds']:.4f}s "
                      f"| Dask {distributed['median_seconds']:.4f}s | "
                      f"speedup {speedup:.2f}x | valid={valid}")
    finally:
        client.close()
        cluster.close()

    payload = {
        "description": "Dask local-process benchmark; includes mining task coordination, excludes cluster startup",
        "environment": {"python": platform.python_version(), "platform": platform.platform(),
                        "cpu_count": os.cpu_count()},
        "parameters": {"difficulties_bits": DIFFICULTIES, "workers": WORKER_COUNTS,
                       "repeats": REPEATS, "batch_size": BATCH_SIZE},
        "results": measurements,
    }
    (base / "pow_distributed_benchmark.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8")
    with (base / "pow_distributed_benchmark.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=measurements[0].keys())
        writer.writeheader()
        writer.writerows(measurements)
    write_progress(base, measurements, running=False)
    print("Resultados guardados en pow_distributed_benchmark.csv y .json")


if __name__ == "__main__":
    main()
