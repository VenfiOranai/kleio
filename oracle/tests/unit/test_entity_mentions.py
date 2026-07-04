"""Unit tests for the pure @[Name] mention parser (no DB / no network)."""

from app.services import entities


def test_no_mentions():
    assert entities.extract_mentions("") == set()
    assert entities.extract_mentions("Just some plain notes.") == set()
    assert entities.extract_mentions(None) == set()  # type: ignore[arg-type]


def test_single_and_multiple():
    assert entities.extract_mentions("We met @[Gandalf].") == {"Gandalf"}
    assert entities.extract_mentions("@[Gandalf] and @[Frodo] talked.") == {"Gandalf", "Frodo"}


def test_names_with_spaces_and_punctuation():
    text = "At @[The Bridge of Khazad-dûm] stood @[Durin's Bane]."
    assert entities.extract_mentions(text) == {"The Bridge of Khazad-dûm", "Durin's Bane"}


def test_adjacent_and_repeated_dedup():
    assert entities.extract_mentions("@[A]@[B]@[A]") == {"A", "B"}


def test_bare_at_word_is_not_a_mention():
    assert entities.extract_mentions("email me at a@b.com or @handle") == set()


def test_blank_brackets_ignored():
    assert entities.extract_mentions("@[] and @[   ] are empty") == set()


def test_surrounding_whitespace_trimmed():
    assert entities.extract_mentions("@[  Gandalf  ]") == {"Gandalf"}


def test_name_cannot_span_newlines():
    # The ] is on the next line, so this is not a valid single-line mention.
    assert entities.extract_mentions("@[Foo\nBar]") == set()


# --- mark_entities (auto-tagging AI summaries) ------------------------------


def test_mark_wraps_known_names():
    assert entities.mark_entities("Gandalf met Frodo.", ["Gandalf", "Frodo"]) == (
        "@[Gandalf] met @[Frodo]."
    )


def test_mark_only_first_occurrence():
    result = entities.mark_entities("Gandalf spoke. Then Gandalf left.", ["Gandalf"])
    assert result == "@[Gandalf] spoke. Then Gandalf left."


def test_mark_is_case_insensitive_and_preserves_casing():
    assert entities.mark_entities("the balrog stirs", ["Balrog"]) == "the @[balrog] stirs"


def test_mark_longer_name_wins():
    assert entities.mark_entities("Meet The Balrog now", ["Balrog", "The Balrog"]) == (
        "Meet @[The Balrog] now"
    )


def test_mark_respects_word_boundaries():
    assert entities.mark_entities("Alabama is not Al.", ["Al"]) == "Alabama is not @[Al]."


def test_mark_does_not_double_wrap_existing_tokens():
    result = entities.mark_entities("@[Gandalf] and Gandalf again", ["Gandalf"])
    assert result == "@[Gandalf] and Gandalf again"


def test_mark_leaves_markdown_links_alone():
    assert entities.mark_entities("see [Balrog](/x) here", ["Balrog"]) == "see [Balrog](/x) here"


def test_mark_no_names_or_text_is_noop():
    assert entities.mark_entities("Gandalf", []) == "Gandalf"
    assert entities.mark_entities("", ["Gandalf"]) == ""
