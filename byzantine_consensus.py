"""Small, deterministic simulation of the classical oral-messages OM(m) algorithm.

It models message delivery and equivocation for teaching purposes; it is not a
network consensus protocol or a production BFT implementation.
"""

from __future__ import annotations

from collections import Counter
from typing import Callable, Hashable, Iterable

Value = Hashable
Delivery = Callable[[str, str, Value, tuple[str, ...]], Value]


def _majority(values: list[Value], default: Value = "RETREAT") -> Value:
    counts = Counter(values)
    highest = max(counts.values())
    winners = [value for value, count in counts.items() if count == highest]
    return winners[0] if len(winners) == 1 else default


def oral_messages_consensus(
    commander: str,
    lieutenants: Iterable[str],
    max_traitors: int,
    initial_value: Value,
    deliver: Delivery | None = None,
) -> dict[str, Value]:
    """Run OM(m) and return each lieutenant's decision.

    `deliver(sender, receiver, value, path)` can alter or omit messages to model
    Byzantine equivocation. Return None for a missing message. The algorithm's
    classical oral-messages bound requires at least 3m+1 total participants.
    """
    lieutenants = tuple(lieutenants)
    if len(set((commander, *lieutenants))) != len(lieutenants) + 1:
        raise ValueError("Los identificadores de nodo deben ser únicos")
    if max_traitors < 0 or len(lieutenants) + 1 < 3 * max_traitors + 1:
        raise ValueError("OM(m) requiere n >= 3m + 1 participantes")

    if deliver is None:
        deliver = lambda sender, receiver, value, path: value

    def run(leader: str, recipients: tuple[str, ...], m: int,
            proposal: Value, path: tuple[str, ...]) -> dict[str, Value]:
        direct = {
            receiver: deliver(leader, receiver, proposal, path + (leader, receiver))
            for receiver in recipients
        }
        if m == 0 or len(recipients) <= 1:
            return {receiver: ("RETREAT" if value is None else value)
                    for receiver, value in direct.items()}

        relayed: dict[str, dict[str, Value]] = {}
        for relay in recipients:
            targets = tuple(node for node in recipients if node != relay)
            relayed[relay] = run(relay, targets, m - 1,
                                 "RETREAT" if direct[relay] is None else direct[relay],
                                 path + (leader, relay))
        decisions: dict[str, Value] = {}
        for receiver in recipients:
            observed = ["RETREAT" if direct[receiver] is None else direct[receiver]]
            observed.extend(relayed[relay][receiver]
                            for relay in recipients if relay != receiver)
            decisions[receiver] = _majority(observed)
        return decisions

    return run(commander, lieutenants, max_traitors, initial_value, ())


def equivocate(messages: dict[tuple[str, str], Value], default: Delivery | None = None) -> Delivery:
    """Build a sender that can send different values to different receivers."""
    def deliver(sender: str, receiver: str, value: Value, path: tuple[str, ...]) -> Value:
        if (sender, receiver) in messages:
            return messages[(sender, receiver)]
        return value if default is None else default(sender, receiver, value, path)
    return deliver


if __name__ == "__main__":
    # Four nodes tolerate one Byzantine node in the OM(1) model.
    decisions = oral_messages_consensus(
        "commander", ["n1", "n2", "traitor"], 1, "ATTACK",
        deliver=equivocate({("commander", "n1"): "ATTACK",
                            ("commander", "n2"): "ATTACK",
                            ("commander", "traitor"): "RETREAT",
                            ("traitor", "n1"): "ATTACK",
                            ("traitor", "n2"): "RETREAT"}),
    )
    print("Decisiones de tenientes OM(1):", decisions)
