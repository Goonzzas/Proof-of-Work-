"""Short, self-contained Python PoW benchmark for Vercel Functions."""
from __future__ import annotations

import base64
import io
import json
import statistics
import time
from http.server import BaseHTTPRequestHandler

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from pow_crypto import (calculate_asymmetry_ratio, generate_pow_challenge,
                        solve_pow, verify_pow)


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # Vercel Python runtime entry point
        try:
            bits_list = (12, 14, 16)
            repeats = 3
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
                results.append({"bits": bits, "hexZeros": bits // 4,
                    "expectedHashes": 2 ** bits,
                    "avgHashes": round(statistics.mean(hashes)),
                    "avgClientMs": client_ms, "avgServerMs": server_ms,
                    "hashRate": round(sum(hashes) / max(sum(client_times) / 1000, 1e-9)),
                    "asymmetryRatio": int(calculate_asymmetry_ratio(client_ms, server_ms))})

            figure, axes = plt.subplots(1, 2, figsize=(10, 4), dpi=110)
            bits = [row["bits"] for row in results]
            axes[0].plot(bits, [row["avgClientMs"] for row in results], "o-", label="Minado cliente")
            axes[0].plot(bits, [row["avgServerMs"] for row in results], "s--", label="Verificación servidor")
            axes[0].set_yscale("log")
            axes[0].set_xlabel("Dificultad (bits)")
            axes[0].set_ylabel("Tiempo (ms)")
            axes[0].legend()
            axes[1].bar([str(bit) for bit in bits], [row["asymmetryRatio"] for row in results])
            axes[1].set_xlabel("Dificultad (bits)")
            axes[1].set_ylabel("Relación de asimetría")
            figure.tight_layout()
            image = io.BytesIO()
            figure.savefig(image, format="png", bbox_inches="tight")
            plt.close(figure)
            chart = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode("ascii")
            return self.reply(200, {"success": True,
                "message": "Benchmark SHA-256 ejecutado en Python dentro de Vercel.",
                "data": results, "chartUrl": chart})
        except Exception as error:
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
