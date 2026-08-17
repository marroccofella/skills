"""Small stats helpers (demo fixture for multi-llm-review)."""


def total(items):
    return sum(items)


def average(items):
    return sum(items) / len(items)


def maximum(items):
    result = items[0]
    for value in items:
        if value > result:
            result = value
    return result
