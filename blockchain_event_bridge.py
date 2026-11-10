#!/usr/bin/env python3
"""Append real, verified rate-limiter requests to a persistent teaching chain."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from blockchain_pow import Block, Blockchain, Transaction, generate_keypair, mine_sequential


def load_chain(path: Path, difficulty: int) -> Blockchain:
    chain = Blockchain(difficulty)
    if not path.exists():
        return chain
    saved = json.loads(path.read_text(encoding="utf-8"))
    chain.difficulty_bits = int(saved.get("difficulty_bits", difficulty))
    for item in saved.get("chain", [])[1:]:
        chain.chain.append(Block(
            index=int(item["index"]), previous_hash=item["previous_hash"],
            transactions=item["transactions"], difficulty_bits=int(item["difficulty_bits"]),
            timestamp=float(item["timestamp"]), nonce=int(item["nonce"]),
            merkle=item["merkle_root"],
        ))
    valid, reason = chain.validate()
    if not valid:
        raise ValueError(f"La cadena guardada no valida: {reason}")
    return chain


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--difficulty", type=int, default=int(os.environ.get("BLOCKCHAIN_EVENT_DIFFICULTY_BITS", "10")))
    args = parser.parse_args()
    events = json.load(sys.stdin)
    if not isinstance(events, list) or not events:
        raise ValueError("Se esperaba una lista no vacía de eventos")

    chain = load_chain(args.store, args.difficulty)
    for event in events:
        private, public = generate_keypair()
        tx = Transaction(sender=public, recipient="rate-limiter", amount=0,
                         timestamp=float(event["timestamp"]), kind="REQUEST_EVENT",
                         metadata=event)
        tx.sign(private)
        chain.add_transaction(tx)

    block = chain.build_candidate()
    mining = mine_sequential(block)
    chain.add_mined_block(block)
    valid, reason = chain.validate()
    if not valid:
        raise ValueError(reason)

    args.store.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.store.with_suffix(args.store.suffix + ".tmp")
    temporary.write_text(json.dumps(chain.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(args.store)
    print(json.dumps({"valid": valid, "reason": reason, "block": {
        "index": block.index, "hash": block.hash, "previous_hash": block.previous_hash,
        "difficulty_bits": block.difficulty_bits, "nonce": block.nonce,
        "transactions": len(block.transactions),
        "mining_seconds": round(mining["elapsed_seconds"], 6),
    }}))


if __name__ == "__main__":
    main()
