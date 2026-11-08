#!/usr/bin/env python3
"""
plot_benchmark.py - Generador de Gráficos Analíticos de Rendimiento PoW en Python con Matplotlib
Genera visualizaciones de alta calidad para la defensa académica del proyecto.
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json
import os

def generate_benchmark_chart():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(base_dir, "pow_benchmark_results.json")
    
    if not os.path.exists(json_path):
        print(f"Error: {json_path} no existe. Ejecuta primero run_benchmark.py")
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    bits = [item['bits'] for item in data]
    client_ms = [item['avgClientMs'] for item in data]
    server_ms = [item['avgServerMs'] for item in data]
    ratios = [item['asymmetryRatio'] for item in data]

    plt.style.use('seaborn-v0_8-darkgrid' if 'seaborn-v0_8-darkgrid' in plt.style.available else 'default')
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6), dpi=150)
    fig.patch.set_facecolor('#1e293b')

    # Subplot 1: Tiempo Cliente (Exponencial) vs Servidor (Constante O(1))
    ax1.set_facecolor('#0f172a')
    line1 = ax1.plot(bits, client_ms, 'o-', color='#38bdf8', linewidth=2.5, markersize=8, label='Cliente: Búsqueda Nonce O(2^k)')
    ax1.set_yscale('log')
    ax1.set_xlabel('Dificultad (Bits de Ceros en SHA-256)', color='#f8fafc', fontsize=11, fontweight='bold')
    ax1.set_ylabel('Tiempo de Cómputo (ms - Escala Log)', color='#f8fafc', fontsize=11, fontweight='bold')
    ax1.set_title('Asimetría Criptográfica: Cliente vs Servidor', color='#ffffff', fontsize=13, fontweight='bold', pad=12)

    ax1_sub = ax1.twinx()
    line2 = ax1_sub.plot(bits, server_ms, 's--', color='#4ade80', linewidth=2, markersize=7, label='Servidor: Verificación O(1)')
    ax1_sub.set_ylabel('Verificación Servidor (ms)', color='#4ade80', fontsize=11, fontweight='bold')
    ax1_sub.tick_params(colors='#4ade80')
    ax1.tick_params(colors='#f8fafc')

    lines = line1 + line2
    labels = [l.get_label() for l in lines]
    ax1.legend(lines, labels, loc='upper left', facecolor='#1e293b', edgecolor='#475569', labelcolor='#ffffff')

    # Subplot 2: Ratio de Asimetría (Factor de Desaliento para Atacantes)
    ax2.set_facecolor('#0f172a')
    bars = ax2.bar([f"{b} bits" for b in bits], ratios, color='#818cf8', width=0.55, edgecolor='#6366f1', linewidth=1.5)
    ax2.set_yscale('log')
    ax2.set_xlabel('Dificultad Requerida', color='#f8fafc', fontsize=11, fontweight='bold')
    ax2.set_ylabel('Ratio de Asimetría (Tiempo Cliente / Servidor)', color='#f8fafc', fontsize=11, fontweight='bold')
    ax2.set_title('Factor de Desaliento para Atacantes (Ratio de Esfuerzo)', color='#ffffff', fontsize=13, fontweight='bold', pad=12)
    ax2.tick_params(colors='#f8fafc')

    for bar in bars:
        height = bar.get_height()
        ax2.annotate(f'{height:,.0f}x',
                    xy=(bar.get_x() + bar.get_width() / 2, height),
                    xytext=(0, 5), textcoords="offset points",
                    ha='center', va='bottom', color='#e2e8f0', fontsize=9, fontweight='bold')

    plt.tight_layout()
    
    out1 = os.path.join(base_dir, 'pow_performance_benchmark.png')
    plt.savefig(out1, dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())
    
    pub_dir = os.path.join(base_dir, 'public')
    if os.path.exists(pub_dir):
        out2 = os.path.join(pub_dir, 'pow_performance_benchmark.png')
        plt.savefig(out2, dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())

    plt.close()
    print(f"[ÉXITO] Gráfico de evaluación generado exitosamente en:\n - {out1}")

if __name__ == "__main__":
    generate_benchmark_chart()
