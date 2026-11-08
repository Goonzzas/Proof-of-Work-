#!/usr/bin/env python3
"""
pow_crypto.py - Módulo en Python con las Funciones Hash y Algoritmos Proof-of-Work (Hashcash)
Contiene las implementaciones criptográficas puras en Python para evaluación y benchmarking.
"""

import hashlib
import hmac
import secrets
import time

SECRET_KEY = b"benchmark-secret-key-python-pow-v7"

def generate_pow_challenge(client_id="py-client", difficulty=4):
    """
    Genera un reto PoW sin estado en Python firmado con HMAC-SHA256.
    """
    timestamp = int(time.time() * 1000)
    server_nonce = secrets.token_hex(8)
    payload = f"{timestamp}:{client_id}:{difficulty}:{server_nonce}"
    signature = hmac.new(SECRET_KEY, payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{payload}:{signature}"

def solve_pow(challenge, difficulty_bits):
    """
    Resuelve el rompecabezas de preimagen parcial en SHA-256 (Algoritmo Hashcash en Python).
    Dada la dificultad en bits k, busca un nonce tal que los primeros k bits de SHA256(challenge + nonce) sean 0.
    """
    full_bytes = difficulty_bits // 8
    remaining_bits = difficulty_bits % 8
    mask = (0xFF << (8 - remaining_bits)) & 0xFF if remaining_bits > 0 else 0

    nonce = 0
    start_time = time.perf_counter()

    while True:
        candidate_bytes = (challenge + str(nonce)).encode('utf-8')
        digest = hashlib.sha256(candidate_bytes).digest()

        # Verificación acelerada de bytes
        valid = True
        for i in range(full_bytes):
            if digest[i] != 0:
                valid = False
                break

        if valid and remaining_bits > 0:
            if (digest[full_bytes] & mask) != 0:
                valid = False

        if valid:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return {
                "nonce": nonce,
                "hashesTested": nonce + 1,
                "timeMs": round(elapsed_ms, 3),
                "hashHex": digest.hex()
            }

        nonce += 1

def verify_pow(challenge, nonce, difficulty_bits):
    """
    Verifica la validez matemática del nonce en tiempo constante O(1) en Python.
    """
    t0 = time.perf_counter()
    full_bytes = difficulty_bits // 8
    remaining_bits = difficulty_bits % 8
    mask = (0xFF << (8 - remaining_bits)) & 0xFF if remaining_bits > 0 else 0

    candidate_bytes = (challenge + str(nonce)).encode('utf-8')
    digest = hashlib.sha256(candidate_bytes).digest()

    valid = True
    for i in range(full_bytes):
        if digest[i] != 0:
            valid = False
            break

    if valid and remaining_bits > 0:
        if (digest[full_bytes] & mask) != 0:
            valid = False

    verify_ms = (time.perf_counter() - t0) * 1000.0
    return {
        "valid": valid,
        "verifyMs": round(verify_ms, 4),
        "hashHex": digest.hex()
    }

def calculate_asymmetry_ratio(client_time_ms, server_time_ms):
    """
    Calcula el factor de esfuerzo asimétrico (Multiplicador de Costo para Atacantes).
    """
    if server_time_ms <= 0:
        server_time_ms = 0.001
    return round(client_time_ms / server_time_ms, 1)

if __name__ == "__main__":
    print("=== TEST INDEPENDIENTE DE FUNCIONES HASH EN PYTHON (pow_crypto.py) ===")
    ch = generate_pow_challenge("test-user", difficulty=4)
    print(f"Reto Generado: {ch}")
    sol = solve_pow(ch, 16)
    print(f"Solución Encontrada: Nonce={sol['nonce']}, Hashes={sol['hashesTested']}, Tiempo={sol['timeMs']}ms, Hash={sol['hashHex']}")
    ver = verify_pow(ch, sol['nonce'], 16)
    print(f"Verificación Servidor O(1): Válido={ver['valid']}, Tiempo={ver['verifyMs']}ms")
