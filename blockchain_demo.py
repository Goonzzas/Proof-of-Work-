#!/usr/bin/env python3
"""Mine and validate one signed-transaction block for the classroom demo."""

import argparse
import json

from blockchain_pow import Blockchain, Transaction, generate_keypair, mine_distributed, mine_sequential


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--difficulty", type=int, default=12, help="leading zero bits (demo: 12-20)")
    parser.add_argument("--workers", type=int, default=1,
                        help="1 for sequential; >1 to mine with local Dask workers")
    parser.add_argument("--output", default="demo_blockchain.json")
    args = parser.parse_args()

    chain = Blockchain(args.difficulty)
    private, public = generate_keypair()
    tx = Transaction(sender=public, recipient="Bob", amount=2.5)
    tx.sign(private)
    chain.add_transaction(tx)
    block = chain.build_candidate()
    mining = (mine_distributed(block, workers=args.workers)
              if args.workers > 1 else mine_sequential(block))
    chain.add_mined_block(block)
    valid, reason = chain.validate()
    result = {"status": reason, "chain_valid": valid,
              "blocks": len(chain.chain), "cumulative_work": chain.cumulative_work(),
              "mining": mining, "block": {**block.header(), "hash": block.hash,
                                            "transactions": block.transactions}}
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"Cadena guardada en {args.output}")


if __name__ == "__main__":
    main()
