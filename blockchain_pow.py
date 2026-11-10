"""Educational SHA-256 proof-of-work blockchain primitives.

This is a classroom model, not a production cryptocurrency. Transactions are
Ed25519-signed, block bodies are committed with a Merkle root, and blocks are
linked by their parent hash. Difficulty is expressed as leading zero bits.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def merkle_root(transactions: Iterable[dict[str, Any]]) -> str:
    """Return a Bitcoin-style Merkle root (duplicate the final odd node)."""
    level = [sha256(canonical_json(tx)) for tx in transactions]
    if not level:
        return sha256(b"").hex()
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [sha256(level[i] + level[i + 1]) for i in range(0, len(level), 2)]
    return level[0].hex()


def meets_target(digest: bytes, difficulty_bits: int) -> bool:
    if not 0 <= difficulty_bits <= 256:
        raise ValueError("difficulty_bits debe estar entre 0 y 256")
    whole, remainder = divmod(difficulty_bits, 8)
    return digest[:whole] == b"\0" * whole and (
        remainder == 0 or digest[whole] >> (8 - remainder) == 0
    )


def generate_keypair() -> tuple[Ed25519PrivateKey, str]:
    private = Ed25519PrivateKey.generate()
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    return private, public_pem


@dataclass
class Transaction:
    sender: str
    recipient: str
    amount: float
    timestamp: float = field(default_factory=time.time)
    signature: str = ""
    kind: str = "TRANSFER"
    metadata: dict[str, Any] = field(default_factory=dict)

    def payload(self) -> dict[str, Any]:
        payload = {"sender": self.sender, "recipient": self.recipient,
                  "amount": self.amount, "timestamp": self.timestamp}
        if self.kind != "TRANSFER" or self.metadata:
            payload.update({"kind": self.kind, "metadata": self.metadata})
        return payload

    def sign(self, private_key: Ed25519PrivateKey) -> None:
        self.signature = base64.b64encode(private_key.sign(canonical_json(self.payload()))).decode("ascii")

    def is_valid(self) -> bool:
        if self.sender == "GENESIS":
            return self.amount >= 0 and bool(self.signature)
        try:
            key = serialization.load_pem_public_key(self.sender.encode("ascii"))
            if not isinstance(key, Ed25519PublicKey) or self.kind not in {"TRANSFER", "REQUEST_EVENT"}:
                return False
            if self.kind == "TRANSFER" and self.amount <= 0:
                return False
            if self.kind == "REQUEST_EVENT" and (self.amount != 0 or not isinstance(self.metadata, dict)):
                return False
            key.verify(base64.b64decode(self.signature, validate=True), canonical_json(self.payload()))
            return True
        except (ValueError, TypeError, InvalidSignature, UnicodeError):
            return False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Block:
    index: int
    previous_hash: str
    transactions: list[dict[str, Any]]
    difficulty_bits: int
    timestamp: float = field(default_factory=time.time)
    nonce: int = 0
    merkle: str = ""

    def __post_init__(self) -> None:
        if not self.merkle:
            self.merkle = merkle_root(self.transactions)

    def header(self) -> dict[str, Any]:
        return {"version": 1, "index": self.index,
                "previous_hash": self.previous_hash, "merkle_root": self.merkle,
                "timestamp": self.timestamp, "difficulty_bits": self.difficulty_bits,
                "nonce": self.nonce}

    def hash_bytes(self) -> bytes:
        return sha256(canonical_json(self.header()))

    @property
    def hash(self) -> str:
        return self.hash_bytes().hex()

    def valid_proof(self) -> bool:
        return self.merkle == merkle_root(self.transactions) and meets_target(
            self.hash_bytes(), self.difficulty_bits
        )

    def mine(self, start_nonce: int = 0, step: int = 1) -> tuple[int, float]:
        started = time.perf_counter()
        self.nonce = start_nonce
        while True:
            digest = self.hash_bytes()
            if meets_target(digest, self.difficulty_bits):
                return self.nonce, time.perf_counter() - started
            self.nonce += step


class Blockchain:
    """A single-process chain with strict validation and accumulated-work fork choice."""

    def __init__(self, difficulty_bits: int = 16):
        if not 0 <= difficulty_bits <= 32:
            raise ValueError("Para la demo, la dificultad debe estar entre 0 y 32 bits")
        self.difficulty_bits = difficulty_bits
        genesis = Block(0, "0" * 64, [], 0, timestamp=0, nonce=0)
        self.chain: list[Block] = [genesis]
        self.pending: list[dict[str, Any]] = []

    @property
    def last_block(self) -> Block:
        return self.chain[-1]

    def add_transaction(self, tx: Transaction | dict[str, Any]) -> None:
        item = tx.to_dict() if isinstance(tx, Transaction) else dict(tx)
        if not Transaction(**item).is_valid():
            raise ValueError("Transacción inválida o firma incorrecta")
        self.pending.append(item)

    def build_candidate(self, difficulty_bits: int | None = None) -> Block:
        return Block(len(self.chain), self.last_block.hash, list(self.pending),
                     self.difficulty_bits if difficulty_bits is None else difficulty_bits)

    def add_mined_block(self, block: Block) -> None:
        if block.index != len(self.chain) or block.previous_hash != self.last_block.hash:
            raise ValueError("El bloque no extiende la punta actual de la cadena")
        if block.timestamp < self.last_block.timestamp:
            raise ValueError("La marca temporal retrocede")
        if not block.valid_proof():
            raise ValueError("Prueba de trabajo o raíz de Merkle inválida")
        if any(not Transaction(**tx).is_valid() for tx in block.transactions):
            raise ValueError("El bloque contiene una transacción inválida")
        self.chain.append(block)
        self.pending.clear()

    def validate(self) -> tuple[bool, str]:
        for i, block in enumerate(self.chain):
            if block.index != i:
                return False, f"índice incorrecto en bloque {i}"
            if i == 0:
                if block.previous_hash != "0" * 64:
                    return False, "hash anterior incorrecto en génesis"
                continue
            previous = self.chain[i - 1]
            if block.previous_hash != previous.hash:
                return False, f"enlace anterior roto en bloque {i}"
            if block.timestamp < previous.timestamp:
                return False, f"marca temporal inválida en bloque {i}"
            if not block.valid_proof():
                return False, f"PoW o Merkle inválido en bloque {i}"
            if any(not Transaction(**tx).is_valid() for tx in block.transactions):
                return False, f"transacción inválida en bloque {i}"
        return True, "cadena válida"

    def cumulative_work(self) -> int:
        return sum(1 << block.difficulty_bits for block in self.chain[1:])

    def consider_chain(self, candidate: list[Block]) -> bool:
        """Adopt a valid chain only when it contains strictly more total work."""
        other = Blockchain(self.difficulty_bits)
        other.chain = candidate
        valid, reason = other.validate()
        if not valid or candidate[0].hash != self.chain[0].hash:
            raise ValueError(f"Cadena candidata inválida: {reason}")
        if other.cumulative_work() > self.cumulative_work():
            self.chain = list(candidate)
            return True
        return False

    def to_dict(self) -> dict[str, Any]:
        return {"difficulty_bits": self.difficulty_bits,
                "chain": [{**block.header(), "hash": block.hash,
                           "transactions": block.transactions} for block in self.chain]}


def mine_distributed(block: Block, workers: int = 4, batch_size: int = 50_000,
                     scheduler_address: str | None = None, client: Any = None) -> dict[str, Any]:
    """Mine nonce intervals concurrently with Dask; return first valid nonce.

    With no scheduler address, starts a local process-based Dask cluster. A
    caller may instead pass a Dask scheduler address to use remote workers.
    """
    if workers < 1 or batch_size < 1:
        raise ValueError("workers y batch_size deben ser positivos")
    try:
        from dask.distributed import Client, LocalCluster, as_completed
    except ImportError as exc:
        raise RuntimeError("Falta Dask. Instala las dependencias con: pip install -r requirements-distributed.txt") from exc

    header = block.header()
    own_client = client is None
    own_cluster = own_client and scheduler_address is None
    cluster = LocalCluster(n_workers=workers, threads_per_worker=1,
                           processes=True, dashboard_address=None) if own_cluster else None
    client = client or Client(cluster if own_cluster else scheduler_address)
    started = time.perf_counter()
    try:
        batch = 0
        total_hashes = 0
        while True:
            futures = []
            for worker_id in range(workers):
                lo = (batch * workers + worker_id) * batch_size
                futures.append(client.submit(_mine_interval, header, lo, lo + batch_size,
                                             pure=False, key=f"pow-{time.time_ns()}-{worker_id}"))
            batch_results = []
            for future in as_completed(futures):
                batch_results.append(future.result())
            solutions = [result for result in batch_results if result is not None]
            for result in batch_results:
                total_hashes += result["hashes_tested"] if result else batch_size
            if solutions:
                result = min(solutions, key=lambda item: item["nonce"])
                block.nonce = result["nonce"]
                elapsed = time.perf_counter() - started
                result.update({"elapsed_seconds": elapsed,
                               "hashes_tested": total_hashes,
                               "workers": workers, "batch_size": batch_size,
                               "hash_rate": total_hashes / max(elapsed, 1e-9)})
                return result
            batch += 1
    finally:
        if own_client:
            client.close()
        if cluster is not None:
            cluster.close()


def _mine_interval(header: dict[str, Any], start: int, stop: int) -> dict[str, Any] | None:
    """Dask worker function; each submitted interval is disjoint."""
    difficulty = header["difficulty_bits"]
    began = time.perf_counter()
    for nonce in range(start, stop):
        candidate = {**header, "nonce": nonce}
        digest = sha256(canonical_json(candidate))
        if meets_target(digest, difficulty):
            return {"nonce": nonce, "hash": digest.hex(),
                    "hashes_tested": nonce - start + 1,
                    "worker_seconds": time.perf_counter() - began}
    return None


def mine_sequential(block: Block) -> dict[str, Any]:
    nonce, elapsed = block.mine()
    hashes = nonce + 1
    return {"nonce": nonce, "hash": block.hash, "hashes_tested": hashes,
            "elapsed_seconds": elapsed, "workers": 1,
            "hash_rate": hashes / max(elapsed, 1e-9)}
