#!/usr/bin/env python3
"""
run_benchmark.py - Suite de Evaluación de Rendimiento y Asimetría Criptográfica Proof-of-Work en Python
Ejecuta pruebas de minado y verificación O(1) evaluando la penalización de CPU según la dificultad.
"""

import json
import os
import sys
from pow_crypto import generate_pow_challenge, solve_pow, verify_pow, calculate_asymmetry_ratio

def run_benchmark():
    print("=== BENCHMARK DE ALGORITMOS PROOF-OF-WORK Y FUNCIONES HASH EN PYTHON ===")
    
    difficulties_bits = [12, 14, 16, 18, 20, 22]
    samples_per_diff = 5
    results = []

    for bits in difficulties_bits:
        hex_zeros = bits // 4
        print(f"Evaluando Dificultad: {bits} bits ({hex_zeros} ceros hex equivalente)...")
        
        total_client_time = 0.0
        total_server_time = 0.0
        total_hashes = 0

        for _ in range(samples_per_diff):
            challenge = generate_pow_challenge("bench-client", hex_zeros)
            solved = solve_pow(challenge, bits)
            verified = verify_pow(challenge, solved["nonce"], bits)

            total_client_time += solved["timeMs"]
            total_server_time += verified["verifyMs"]
            total_hashes += solved["hashesTested"]

        avg_client_ms = round(total_client_time / samples_per_diff, 2)
        avg_server_ms = round(total_server_time / samples_per_diff, 4)
        avg_hashes = round(total_hashes / samples_per_diff)
        hash_rate = round(total_hashes / (total_client_time / 1000.0)) if total_client_time > 0 else 0
        asymmetry_ratio = calculate_asymmetry_ratio(avg_client_ms, avg_server_ms)

        results.append({
            "bits": bits,
            "hexZeros": hex_zeros,
            "expectedHashes": 2 ** bits,
            "avgHashes": avg_hashes,
            "avgClientMs": avg_client_ms,
            "avgServerMs": avg_server_ms,
            "hashRate": hash_rate,
            "asymmetryRatio": int(asymmetry_ratio)
        })

        print(f"  -> Cliente: {avg_client_ms} ms | Hashes: {avg_hashes} | Servidor O(1): {avg_server_ms} ms | Ratio Asimetría: {int(asymmetry_ratio)}x")

    base_dir = os.path.dirname(os.path.abspath(__file__))
    pub_dir = os.path.join(base_dir, "public")

    # Guardar en JSON
    json_str = json.dumps(results, indent=2)
    with open(os.path.join(base_dir, "pow_benchmark_results.json"), "w", encoding="utf-8") as f:
        f.write(json_str)
    if os.path.exists(pub_dir):
        with open(os.path.join(pub_dir, "pow_benchmark_results.json"), "w", encoding="utf-8") as f:
            f.write(json_str)

    # Guardar en CSV
    csv_header = "Bits,HexZeros,ExpectedHashes,AvgHashesTested,ClientTimeMs,ServerTimeMs,HashRate,AsymmetryRatio\n"
    csv_lines = [csv_header]
    for r in results:
        csv_lines.append(f"{r['bits']},{r['hexZeros']},{r['expectedHashes']},{r['avgHashes']},{r['avgClientMs']},{r['avgServerMs']},{r['hashRate']},{r['asymmetryRatio']}\n")
    
    csv_str = "".join(csv_lines)
    with open(os.path.join(base_dir, "pow_benchmark_results.csv"), "w", encoding="utf-8") as f:
        f.write(csv_str)
    if os.path.exists(pub_dir):
        with open(os.path.join(pub_dir, "pow_benchmark_results.csv"), "w", encoding="utf-8") as f:
            f.write(csv_str)

    print("\n[ÉXITO] Benchmark completado. Resultados JSON y CSV guardados correctamente.")

if __name__ == "__main__":
    run_benchmark()
