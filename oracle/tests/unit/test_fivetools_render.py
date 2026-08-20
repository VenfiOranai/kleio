"""Unit tests for the PURE 5etools renderer: `{@tag}` markup and `entries` → Markdown."""

import pytest

from app.services.fivetools.render import entries_to_markdown, render_text


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        # Dice/damage tags keep the roll (or its display override).
        ("takes {@damage 1d10} fire damage", "takes 1d10 fire damage"),
        ("roll {@dice 1d20+3|+3}", "roll +3"),
        ("increases by {@scaledamage 8d6|3-9|1d6}", "increases by 1d6"),
        # Cross-references collapse to their display text.
        ("cast {@spell fireball}", "cast fireball"),
        ("cast {@spell fireball|phb|a fireball}", "cast a fireball"),
        ("a {@item longsword|phb}", "a longsword"),
        ("is {@condition prone}", "is prone"),
        ("{@creature goblin||goblins}", "goblins"),
        # Formatting tags become Markdown.
        ("{@b careful} now", "**careful** now"),
        ("{@i flammable objects}", "*flammable objects*"),
        ("{@s wrong}", "~~wrong~~"),
        # Special-cased tags.
        ("{@dc 15}", "DC 15"),
        ("{@hit 5} to hit", "+5 to hit"),
        ("{@hit -1} to hit", "-1 to hit"),
        ("{@recharge 5}", "(Recharge 5–6)"),
        ("{@chance 50} of rain", "50 percent of rain"),
        # Unknown tags degrade to their first argument rather than leaking braces.
        ("{@somethingNew a thing|src}", "a thing"),
        # Nesting resolves innermost-first.
        ("{@i see {@spell fireball}}", "*see fireball*"),
        # Text without markup is untouched.
        ("plain text", "plain text"),
    ],
)
def test_render_text(source: str, expected: str):
    assert render_text(source) == expected


def test_strings_become_paragraphs():
    assert entries_to_markdown(["first", "second"]) == "first\n\nsecond"


def test_named_entry_is_bolded_inline():
    entries = [{"type": "entries", "name": "Ignition", "entries": ["The fire spreads."]}]
    assert entries_to_markdown(entries) == "**Ignition.** The fire spreads."


def test_nested_named_entries_flatten_to_paragraphs():
    entries = [
        "Intro.",
        {
            "type": "entries",
            "name": "Outer",
            "entries": ["Body.", {"type": "entries", "name": "Inner", "entries": ["Deep."]}],
        },
    ]
    assert entries_to_markdown(entries) == "Intro.\n\n**Outer.** Body.\n\n**Inner.** Deep."


def test_lists_become_bullets_with_named_items():
    entries = [
        {
            "type": "list",
            "items": [
                "plain item",
                {"type": "item", "name": "Wall of Fire", "entry": "4 charges"},
            ],
        }
    ]
    assert entries_to_markdown(entries) == "- plain item\n- **Wall of Fire.** 4 charges"


def test_nested_lists_indent():
    entries = [
        {
            "type": "list",
            "items": ["top", {"type": "list", "items": ["nested"]}],
        }
    ]
    assert entries_to_markdown(entries) == "- top\n  - nested"


def test_tables_render_as_markdown_with_roll_ranges():
    entries = [
        {
            "type": "table",
            "caption": "Magic Auras",
            "colLabels": ["{@dice d6}", "School"],
            "rows": [
                [{"type": "cell", "roll": {"min": 1, "max": 3}}, "Abjuration"],
                [{"type": "cell", "roll": {"exact": 6}}, "Evocation"],
            ],
        }
    ]
    assert entries_to_markdown(entries) == (
        "**Magic Auras**\n\n"
        "| d6 | School |\n"
        "| --- | --- |\n"
        "| 1–3 | Abjuration |\n"
        "| 6 | Evocation |"
    )


def test_table_cells_escape_pipes():
    entries = [{"type": "table", "colLabels": ["A"], "rows": [["x|y"]]}]
    assert "| x\\|y |" in entries_to_markdown(entries)


def test_insets_and_quotes_become_blockquotes():
    entries = [{"type": "quote", "entries": ["Fly, you fools."], "by": "Gandalf"}]
    assert entries_to_markdown(entries) == "> Fly, you fools.\n>\n> — Gandalf"


def test_unrenderable_entry_types_are_dropped_not_crashed():
    entries = ["kept", {"type": "image", "href": {"url": "x.png"}}, {"type": "refClassFeature"}]
    assert entries_to_markdown(entries) == "kept"


def test_unknown_entry_type_keeps_its_prose():
    entries = [{"type": "somethingNew", "name": "Odd", "entries": ["still useful"]}]
    assert entries_to_markdown(entries) == "**Odd.** still useful"


def test_empty_entries_render_to_empty_string():
    assert entries_to_markdown([]) == ""
    assert entries_to_markdown(None) == ""
