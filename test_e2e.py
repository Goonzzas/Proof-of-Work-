#!/usr/bin/env python3
"""
test_e2e.py - Prueba de Integración End-to-End (E2E) en Python
Valida el protocolo HTTP con el servidor Node.js y prueba el minado en Python.
"""

import urllib.request
import urllib.parse
import json
import time
from pow_crypto import solve_pow, verify_pow

BASE_URL = "http://localhost:3000"

def run_e2e_test():
    print("=== INICIANDO PRUEBA DE INTEGRACIÓN E2E (PYTHON -> NODE.JS SERVER) ===")
    
    # 1. Solicitar Reto PoW a Node.js
    print("1. Solicitando reto a GET /api/pow/challenge...")
    req = urllib.request.Request(f"{BASE_URL}/api/pow/challenge?clientId=python-e2e-tester")
    with urllib.request.urlopen(req) as resp:
        ch_data = json.loads(resp.read().decode('utf-8'))

    challenge = ch_data["challenge"]
    difficulty = ch_data["difficulty"]
    print(f"   Reto recibido: Dificultad = {difficulty} ceros hex ({difficulty * 4} bits)")
    print(f"   Challenge string: {challenge[:40]}...")

    # 2. Minar solución usando el algoritmo en Python (pow_crypto)
    print("2. Minando solución usando las funciones Hash en Python (solve_pow)...")
    sol = solve_pow(challenge, difficulty * 4)
    print(f"   ¡Solución encontrada en {sol['timeMs']}ms!")
    print(f"   Nonce: {sol['nonce']}, Hash: {sol['hashHex']}")

    # 3. Enviar solución al middleware de Node.js en HTTP POST
    print("3. Enviando solución al API Gateway Node.js en POST /api/heavy-report...")
    post_req = urllib.request.Request(
        f"{BASE_URL}/api/heavy-report",
        headers={
            "X-PoW-Challenge": challenge,
            "X-PoW-Response": str(sol["nonce"]),
            "Content-Type": "application/json"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(post_req) as resp:
            body = json.loads(resp.read().decode('utf-8'))
            print(f"   Respuesta del Servidor (HTTP {resp.status}):")
            print(f"   Status: {body.get('status')}, Mensaje: {body.get('message')}")
            print(f"   Verificación Servidor Node.js: {body['powMetrics']['serverVerifyTimeMs']} ms")
            print("✅ PRUEBA E2E COMPLETADA CON ÉXITO.")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        print(f"❌ Error HTTP {e.code}: {err_body}")

if __name__ == "__main__":
    try:
        run_e2e_test()
    except Exception as e:
        print(f"Aviso: El servidor Node.js debe estar activo en http://localhost:3000 para la prueba E2E HTTP. Detalles: {e}")
