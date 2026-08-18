# Translating code without breaking it

The point of this skill is that the build still passes afterwards. Code is
translated **by hand, zone by zone** — never by piping a source file
through `yorkshirify.mjs`, which is for prose only.

## The zone map

### Translate freely

| Zone | Notes |
|---|---|
| Comments (`//`, `#`, `/* */`, `<!-- -->`) | The main event. Full gravy level applies. |
| Docstrings | Keep any structured parts (`:param x:`, `@returns`) intact; translate the prose between them. |
| README / docs / markdown prose | Treat as prose; the script works here. |
| Commit message bodies | Keep conventional-commit prefixes, issue refs, and trailers untouched. |

### Translate only after checking consumers

| Zone | The check before touching it |
|---|---|
| Log messages | Grep for the exact string in tests, alerting rules, and log parsers. If anything matches on it, leave it. |
| CLI help text / UI copy | Confirm no snapshot test or doc screenshot asserts the exact wording. |
| Exception messages | Grep for `assertRaises`/`toThrow`/`pytest.raises(match=...)` on the message text. |

When translating any of these, keep every placeholder exactly as-is:
`%s`, `%d`, `{}`, `{name}`, `${var}`, `{{mustache}}`, positional `{0}`.
"Summat went wrong wi' %s" is fine; changing `%s` is not.

### Never touch

- Identifiers: variables, functions, classes, modules, CSS classes, HTML ids
- Language keywords, operators, syntax
- Dictionary/object **keys**, enum values, config keys, environment variable names
- URLs, file paths, imports
- Regexes, SQL, shell commands embedded in strings
- i18n/translation keys (`t("checkout.title")`) — and do not edit locale
  files as a joke; that ships
- Test fixtures and golden files compared byte-for-byte
- Version strings, dates, hashes, licenses

## Verification

After translating, run the project's own tests (or at minimum the
linter/compiler for the touched files). A translation that fails a test is
wrong by definition — revert that zone, don't weaken the test.

## Worked examples

### Python

Before:

```python
def retry(fn, attempts=3):
    """Retry a callable a few times before giving up.

    :param attempts: how many tries before we raise.
    """
    # The last error is re-raised if nothing succeeds.
    for i in range(attempts):
        try:
            return fn()
        except TransientError as e:
            last = e
    raise last
```

After (`proper`):

```python
def retry(fn, attempts=3):
    """'Ave another go at a callable a few times afore givin' up.

    :param attempts: 'ow many tries afore we raise.
    """
    # T'last error gets raised again if nowt succeeds.
    for i in range(attempts):
        try:
            return fn()
        except TransientError as e:
            last = e
    raise last
```

`retry`, `attempts`, `TransientError`, and the `:param` field name are
untouched. Only prose moved.

### JavaScript

Before:

```js
// Cache miss: fetch from origin and remember it for next time.
logger.warn(`upstream slow, took ${ms}ms`);
```

After (`proper`, having checked no test greps the log line):

```js
// Cache miss: fetch it from origin an' remember it for next time, sithee.
logger.warn(`upstream's draggin' its clogs, took ${ms}ms`);
```

`${ms}` survives exactly.

## Full-pudding mode (identifiers too)

Only for throwaway joke code. Requires all of:

1. The user explicitly asked for identifiers to be renamed **after** being
   warned it changes the public API and breaks callers.
2. The code is not on any branch that ships — demo, gist, or scratch only.
3. Every rename is applied consistently (definition + all references), so
   the joke version still runs: `fetchData` → `fetchTGubbins` everywhere,
   not just at the definition.

If any of the three fails, decline the rename and offer comments-and-strings
translation instead.
