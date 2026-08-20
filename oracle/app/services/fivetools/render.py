"""PURE 5etools text rendering — ``{@tag}`` markup + nested ``entries`` arrays → Markdown.

No IO, no DB, no config: every function here is a plain transform over plain data (the same
rule as ``character_calc``), so it is exhaustively unit-testable against small JSON fixtures.

5etools stores prose as an ``entries`` array whose elements are either strings or typed
objects (``entries`` / ``list`` / ``table`` / ``item`` / ``quote`` / …), and peppers the
strings with inline markup like ``{@spell fireball|phb|a fireball}`` or ``{@dice 1d6}``.
``render_text`` resolves the markup to plain text; ``entries_to_markdown`` renders a whole
array to Markdown, which is what our ``description`` fields hold.
"""

import re
from typing import Any

# One tag with no braces inside it. Nested tags are resolved innermost-first by repeatedly
# re-running this over the result (see `render_text`), which keeps the regex trivial.
_TAG_RE = re.compile(r"\{@(\w+)(?:[ \n]+([^{}]*))?\}")

# Inline markup that maps straight onto Markdown emphasis.
_EMPHASIS = {
    "b": "**",
    "bold": "**",
    "i": "*",
    "italic": "*",
    "s": "~~",
    "strike": "~~",
    "code": "`",
}

# Tags whose display text is the *last* pipe-part (e.g. `{@dice 1d20+3|+3}` → "+3").
_LAST_PART = {"dice", "damage", "scaledice", "scaledamage", "autodice", "d20"}

# Attack-type codes used by `{@atk}` in stat blocks (spells occasionally carry them).
_ATTACK_TYPES = {
    "mw": "Melee Weapon Attack",
    "rw": "Ranged Weapon Attack",
    "mws": "Melee Weapon or Spell Attack",
    "ms": "Melee Spell Attack",
    "rs": "Ranged Spell Attack",
    "m": "Melee Attack",
    "r": "Ranged Attack",
    "a": "Area Attack",
}


def render_text(text: str) -> str:
    """Resolve every ``{@tag …}`` in one string, innermost first, to plain Markdown."""
    out = text
    # Bounded loop: each pass resolves the innermost layer, so a handful covers real data
    # and a pathological/unbalanced string can never spin forever.
    for _ in range(8):
        resolved = _TAG_RE.sub(_render_tag, out)
        if resolved == out:
            break
        out = resolved
    return out


def _render_tag(match: re.Match[str]) -> str:
    tag = match.group(1).lower()
    parts = (match.group(2) or "").split("|")
    first = parts[0].strip()

    if tag in _EMPHASIS:
        marker = _EMPHASIS[tag]
        return f"{marker}{first}{marker}" if first else ""
    if tag in _LAST_PART:
        display = next((p.strip() for p in reversed(parts) if p.strip()), "")
        return display
    if tag == "hit":
        return first if first.startswith(("+", "-", "−")) else f"+{first}"
    if tag == "dc":
        return f"DC {first}"
    if tag == "chance":
        return f"{first} percent"
    if tag == "recharge":
        return f"(Recharge {first}\u20136)" if first else "(Recharge 6)"
    if tag == "atk":
        codes = [_ATTACK_TYPES.get(c.strip().lower(), c.strip()) for c in first.split(",") if c]
        return ", ".join(codes) + ":"
    if tag == "h":
        return "*Hit:* "
    if tag == "hom":
        return "*Hit or Miss:* "
    if tag == "m":
        return "*Miss:* "
    if tag == "footnote":
        return first
    if tag == "link":
        # `{@link display|url}`
        return f"[{first}]({parts[1].strip()})" if len(parts) > 1 else first
    # Everything else is a cross-reference (`{@spell x|src|display}`, `{@condition prone}`,
    # `{@item longsword|phb}`, …): show the explicit display text when given, else the name.
    if len(parts) >= 3 and parts[2].strip():
        return parts[2].strip()
    return first


def entries_to_markdown(entries: Any, depth: int = 0) -> str:
    """Render a 5etools ``entries`` array (or a single entry) to Markdown."""
    return "\n\n".join(block for block in _blocks(entries, depth) if block.strip())


def _blocks(entry: Any, depth: int) -> list[str]:
    """Render one entry (or list of entries) into a list of Markdown blocks."""
    if entry is None:
        return []
    if isinstance(entry, list):
        return [block for item in entry for block in _blocks(item, depth)]
    if isinstance(entry, str):
        return [render_text(entry)]
    if isinstance(entry, int | float):
        return [str(entry)]
    if not isinstance(entry, dict):
        return []

    kind = entry.get("type", "entries")

    if kind in ("entries", "section", "variant", "variantSub", "options", "optfeature"):
        return _named_blocks(entry, depth)
    if kind in ("inset", "insetReadaloud", "quote"):
        return [_quote(_named_blocks(entry, depth), entry.get("by"))]
    if kind == "list":
        return [_list_block(entry, depth)]
    if kind == "table":
        return [_table_block(entry)]
    if kind in ("item", "itemSub", "itemSpell", "itemTierRef"):
        return [_item_block(entry, depth)]
    if kind == "abilityDc":
        return [f"**{entry.get('name', 'Spell')} save DC** = 8 + your proficiency bonus + "
                f"your {_ability_names(entry)} modifier"]
    if kind == "abilityAttackMod":
        return [f"**{entry.get('name', 'Spell')} attack modifier** = your proficiency bonus + "
                f"your {_ability_names(entry)} modifier"]
    if kind == "abilityGeneric":
        return [render_text(str(entry.get("text", "")))]
    if kind == "link":
        href = entry.get("href", {}).get("url", "")
        return [f"[{render_text(str(entry.get('text', '')))}]({href})" if href else ""]
    if kind == "hr":
        return ["---"]
    if kind in ("image", "gallery", "flowchart", "ingredient", "statblock", "statblockInline"):
        return []  # nothing useful to show in a character-sheet description
    if kind.startswith("ref"):
        return []  # refClassFeature / refSubclassFeature / refOptionalfeature — Phase 14 territory

    # Unknown wrapper: keep whatever prose it carries rather than dropping it.
    return _named_blocks(entry, depth)


def _named_blocks(entry: dict[str, Any], depth: int) -> list[str]:
    """Render an entry's body, prefixing the first block with its bolded ``name``."""
    body = _blocks(entry.get("entries", entry.get("entry", [])), depth)
    name = str(entry.get("name", "")).strip()
    if not name:
        return body
    label = f"**{render_text(name)}.**"
    if body and not body[0].startswith(("|", "-", ">")):
        return [f"{label} {body[0]}", *body[1:]]
    return [label, *body]


def _quote(body: list[str], by: str | None) -> str:
    lines = "\n\n".join(body).split("\n")
    quoted = "\n".join(f"> {line}" if line else ">" for line in lines)
    return f"{quoted}\n>\n> — {render_text(by)}" if by else quoted


def _list_block(entry: dict[str, Any], depth: int) -> str:
    return "\n".join(
        line for item in entry.get("items", []) for line in _list_item_lines(item, depth)
    )


def _list_item_lines(item: Any, depth: int) -> list[str]:
    indent = "  " * depth
    if isinstance(item, dict) and item.get("type") == "list":
        return [line for sub in item.get("items", []) for line in _list_item_lines(sub, depth + 1)]
    text = "\n\n".join(b for b in _blocks(item, depth) if b.strip())
    if not text.strip():
        return []
    first, *rest = text.split("\n")
    # Continuation lines are indented so multi-paragraph items stay inside the bullet.
    return [f"{indent}- {first}", *(f"{indent}  {line}" if line else "" for line in rest)]


def _item_block(entry: dict[str, Any], depth: int) -> str:
    name = str(entry.get("name", "")).strip()
    body = "\n\n".join(b for b in _blocks(entry.get("entries", entry.get("entry", [])), depth))
    if name and body:
        return f"**{render_text(name)}.** {body}"
    return f"**{render_text(name)}.**" if name else body


def _table_block(entry: dict[str, Any]) -> str:
    rows = [_table_row(row) for row in entry.get("rows", [])]
    labels = [_cell_text(label) for label in entry.get("colLabels", [])]
    if not labels:
        width = max((len(r) for r in rows), default=0)
        labels = [""] * width
    if not labels:
        return ""
    lines = [
        "| " + " | ".join(labels) + " |",
        "| " + " | ".join("---" for _ in labels) + " |",
    ]
    for row in rows:
        cells = (row + [""] * len(labels))[: len(labels)]
        lines.append("| " + " | ".join(cells) + " |")
    table = "\n".join(lines)
    caption = str(entry.get("caption", "")).strip()
    return f"**{render_text(caption)}**\n\n{table}" if caption else table


def _table_row(row: Any) -> list[str]:
    cells = row.get("row", []) if isinstance(row, dict) else row
    return [_cell_text(cell) for cell in cells] if isinstance(cells, list) else []


def _cell_text(cell: Any) -> str:
    if isinstance(cell, dict):
        roll = cell.get("roll")
        if isinstance(roll, dict):
            if "exact" in roll:
                return str(roll["exact"])
            return f"{roll.get('min', '')}\u2013{roll.get('max', '')}"
        cell = cell.get("entry", cell.get("entries", ""))
    text = "\n\n".join(b for b in _blocks(cell, 0) if b.strip())
    # Pipes would break the Markdown table; newlines would break the row.
    return text.replace("|", "\\|").replace("\n", " ").strip()


def _ability_names(entry: dict[str, Any]) -> str:
    names = {
        "str": "Strength",
        "dex": "Dexterity",
        "con": "Constitution",
        "int": "Intelligence",
        "wis": "Wisdom",
        "cha": "Charisma",
    }
    attrs = entry.get("attributes", [])
    if isinstance(attrs, str):
        attrs = [attrs]
    return " or ".join(names.get(a, a) for a in attrs) or "spellcasting ability"
