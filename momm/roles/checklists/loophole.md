---
checklist: loophole
version: 1
review_by: 2027-03-29
---
Loophole checklist (look for places where the artifact's letter is met while its purpose is missed):
- Letter against spirit: a rule, check or test is satisfied literally while the outcome it exists to protect is not.
- Categorical arbitrage: an input, state or actor is placed in a category the rule does not name, so the rule never applies to it.
- Temporal latency: a check and the action it guards happen at different times, so the state can change in between (stale reads, expiry, races, a sunset that never fires).
- Compositional blind spots: each part is safe on its own, but a combination of parts, calls or steps reaches a state no single part allows.
Techniques: boundary values; intent anchoring; invariants; payoff auditing; sunset and review triggers.
A finding raised through this checklist must still quote the artifact exactly and name a concrete sequence of steps that reaches the loophole; a loophole you cannot walk step by step is not a finding.
