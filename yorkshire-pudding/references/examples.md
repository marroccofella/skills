# Worked examples

Before/after pairs at each gravy level, showing the judgement calls the
script can't make. Use these as calibration, not templates.

## A joke

The rule for jokes: translate the setup lightly, spend the dialect on the
punchline, and let understatement do the work.

Before:

> Why do programmers prefer dark mode? Because light attracts bugs.

After (`proper`):

> Why do programmers prefer dark mode? 'Cause light brings t'bugs in, an'
> we've got enough o' them already, ta.

The punchline gained a dry Yorkshire tag ("ta") instead of an exclamation —
Yorkshire jokes end with a shrug, not a drum roll.

## An error message

Before:

> Error: connection to the database failed. Please check your
> configuration and try again.

After (`proper`, for a demo app where nothing parses the message):

> Error: t'database in't answering. 'Ave a look at thi config an' give it
> another go.

After (`mild`, for anything closer to production):

> Error: connection to the database failed. Check your configuration and
> have another go, love.

Note the word "Error:" survives both — tooling greps for it.

## A commit message

Before:

> fix: handle empty cart on checkout
>
> The total was NaN when the cart was empty because we divided by the
> item count. Guard the division and add a regression test.

After (`proper`):

> fix: handle empty cart on checkout
>
> T'total were NaN when t'cart were empty 'cause we divided by t'item
> count. Guard t'division an' add a regression test.

The `fix:` prefix and the subject line stay untranslated — the subject is
what tooling and changelogs consume; the body is prose.

## Prose (README paragraph)

Before:

> This library is very fast, has no dependencies, and is thoroughly
> tested. We think you'll be pleased with it.

After (`broad`):

> This library's proper fast, 'as nowt in t'way o' dependencies, an' it's
> been tested to within an inch o' its life. We reckon tha'll be right
> chuffed wi' it.

## Python (full example)

Before:

```python
def average(items):
    """Return the mean of a non-empty collection."""
    # Sum first, then divide — nothing clever here.
    if not items:
        raise ValueError("cannot average an empty collection")
    return sum(items) / len(items)
```

After (`proper` — the ValueError message was checked: no test matches on it):

```python
def average(items):
    """Give back t'mean of a non-empty collection."""
    # Add 'em up first, then divide — nowt clever 'ere.
    if not items:
        raise ValueError("can't tek an average o' nowt, lad")
    return sum(items) / len(items)
```

`average`, `items`, `ValueError`, and the logic are untouched. If a test
had asserted on the message text, the string would have stayed English.

## What over-seasoning looks like (don't do this)

> Ee by gum, by 'eck, well I'll go to t'foot of our stairs, this 'ere
> library is reet champion beltin' grand, tha knows, sithee, ta'ra!

One exclamation per paragraph. Grammar carries broadness; piling up
catchphrases reads as mockery, which breaks golden rule two.
