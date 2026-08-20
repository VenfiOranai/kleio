"""PURE 5etools → Kleio schema normalization.

Turns a raw 5etools spell / item / feat / optional-feature object into the shapes the
character sheet already stores (``Spell`` / ``EquipmentItem`` / ``Feature`` / ``Attack`` in
``app.schemas.character``), plus the cheap *facets* the reference browser filters and sorts
on. Like :mod:`.render` it is pure — dicts in, dicts out — so it is unit-tested against small
fixtures without touching the filesystem.

Two 5etools quirks are handled here rather than in the loader, because they are data
transforms and belong under test: ``_copy`` inheritance between items, and **magic-variant
assembly** (``magicvariants.json`` × ``items-base.json`` ⇒ "Longsword +1", "Adamantine Plate
Armor", …).
"""

import re
from typing import Any

from .render import entries_to_markdown, render_text

SPELL_SCHOOLS = {
    "A": "Abjuration",
    "C": "Conjuration",
    "D": "Divination",
    "E": "Enchantment",
    "V": "Evocation",
    "I": "Illusion",
    "N": "Necromancy",
    "T": "Transmutation",
    "P": "Psionic",
}

DAMAGE_TYPES = {
    "A": "acid",
    "B": "bludgeoning",
    "C": "cold",
    "F": "fire",
    "O": "force",
    "L": "lightning",
    "N": "necrotic",
    "P": "piercing",
    "I": "poison",
    "Y": "psychic",
    "R": "radiant",
    "S": "slashing",
    "T": "thunder",
}

# Fallback item-type names; the real ones come from `items-base.json`'s `itemType` array
# when the dataset provides it (see `index.py`).
ITEM_TYPE_NAMES = {
    "$": "Treasure",
    "A": "Ammunition",
    "AF": "Ammunition (futuristic)",
    "AIR": "Vehicle (air)",
    "AT": "Artisan's Tools",
    "EM": "Eldritch Machine",
    "EXP": "Explosive",
    "FD": "Food and Drink",
    "G": "Adventuring Gear",
    "GS": "Gaming Set",
    "HA": "Heavy Armor",
    "IDG": "Illegal Drug",
    "INS": "Instrument",
    "LA": "Light Armor",
    "M": "Melee Weapon",
    "MA": "Medium Armor",
    "MNT": "Mount",
    "OTH": "Other",
    "P": "Potion",
    "R": "Ranged Weapon",
    "RD": "Rod",
    "RG": "Ring",
    "S": "Shield",
    "SC": "Scroll",
    "SCF": "Spellcasting Focus",
    "SHP": "Vehicle (water)",
    "SPC": "Vehicle (space)",
    "T": "Tools",
    "TAH": "Tack and Harness",
    "TG": "Trade Good",
    "VEH": "Vehicle (land)",
    "WD": "Wand",
}

# Our sheet's preset equipment buckets, keyed by 5etools item-type abbreviation.
_CATEGORY_BY_TYPE = {
    "M": "Weapons",
    "R": "Weapons",
    "A": "Weapons",
    "AF": "Weapons",
    "LA": "Armor",
    "MA": "Armor",
    "HA": "Armor",
    "S": "Armor",
    "P": "Consumables",
    "SC": "Consumables",
    "FD": "Consumables",
    "EXP": "Consumables",
    "IDG": "Consumables",
    "$": "Treasure",
    "TG": "Treasure",
}

RARITY_ORDER = [
    "none",
    "common",
    "uncommon",
    "rare",
    "very rare",
    "legendary",
    "artifact",
    "varies",
    "unknown",
    "unknown (magic)",
]

# `optionalfeatures.json` feature-type codes → readable "kind" labels.
OPTIONAL_FEATURE_KINDS = {
    "AI": "Artificer Infusion",
    "AS": "Arcane Shot",
    "ED": "Elemental Discipline",
    "EI": "Eldritch Invocation",
    "FS:B": "Fighting Style (Bard)",
    "FS:F": "Fighting Style (Fighter)",
    "FS:P": "Fighting Style (Paladin)",
    "FS:R": "Fighting Style (Ranger)",
    "MM": "Metamagic",
    "MV": "Maneuver",
    "MV:B": "Maneuver (Battle Master)",
    "OR": "Onomancy Resonant",
    "PB": "Pact Boon",
    "RN": "Rune",
    "SHP:H": "Ship Upgrade",
    "TT": "Traveler's Trick",
}


def scalar(value: Any) -> str:
    """A 5etools scalar field as display text.

    Not just `str()`: several of them carry inline markup of their own (e.g. a Luck Blade's
    ``"charges": "{@dice 1d4 - 1}"``), which would otherwise leak into the stat line.
    """
    return render_text(str(value))


def strip_source(value: Any) -> str:
    """5etools suffixes many codes with their source (``"M|PHB"``, ``"F|XPHB"``)."""
    if isinstance(value, dict):  # newer property entries are `{"uid": "F|PHB"}`
        value = value.get("uid", "")
    return str(value or "").split("|", 1)[0].strip()


# --- Spells ------------------------------------------------------------------


def normalize_spell(raw: dict[str, Any], classes: list[str] | None = None) -> dict[str, Any]:
    """A 5etools spell → our ``Spell`` shape (``prepared`` flags stay false; the user decides)."""
    duration = raw.get("duration") or []
    return {
        "name": str(raw.get("name", "")),
        "level": int(raw.get("level", 0) or 0),
        "school": SPELL_SCHOOLS.get(str(raw.get("school", "")).upper(), ""),
        "prepared": False,
        "always_prepared": False,
        "ritual": bool((raw.get("meta") or {}).get("ritual")),
        "concentration": any(d.get("concentration") for d in duration if isinstance(d, dict)),
        "casting_time": format_casting_time(raw.get("time") or []),
        "range": format_range(raw.get("range") or {}),
        "components": format_components(raw.get("components") or {}),
        "duration": format_duration(duration),
        "description": entries_to_markdown(raw.get("entries") or []),
        "at_higher_levels": _higher_levels(raw),
        # Not part of the stored schema, but handy context in the browser's detail pane.
        "_classes": sorted(classes or spell_classes(raw)),
    }


def spell_facets(raw: dict[str, Any], classes: list[str] | None = None) -> dict[str, Any]:
    """Cheap filter/sort facets — computed at index time, so no ``entries`` rendering here."""
    level = int(raw.get("level", 0) or 0)
    school = SPELL_SCHOOLS.get(str(raw.get("school", "")).upper(), "")
    duration = raw.get("duration") or []
    names = sorted(classes or spell_classes(raw))
    level_label = "Cantrip" if level == 0 else f"Level {level}"
    return {
        "level": level,
        "school": school,
        "classes": names,
        "ritual": bool((raw.get("meta") or {}).get("ritual")),
        "concentration": any(d.get("concentration") for d in duration if isinstance(d, dict)),
        "subtitle": " · ".join(filter(None, [f"{level_label} {school}".strip(), ", ".join(names)])),
    }


def spell_classes(raw: dict[str, Any]) -> list[str]:
    """Class names that can cast the spell, from the spell's own (older) ``classes`` block."""
    block = raw.get("classes") or {}
    names: set[str] = set()
    for key in ("fromClassList", "fromClassListVariant"):
        names |= {c.get("name", "") for c in block.get(key, []) if isinstance(c, dict)}
    for entry in block.get("fromSubclass", []):
        if isinstance(entry, dict):
            names.add((entry.get("class") or {}).get("name", ""))
    return sorted(n for n in names if n)


def classes_from_sources(entry: dict[str, Any]) -> list[str]:
    """Class names from the newer ``spells/sources.json`` layout (per source, per spell)."""
    names: set[str] = set()
    for key in ("class", "classVariant"):
        for item in entry.get(key, []) or []:
            if isinstance(item, dict) and item.get("name"):
                names.add(item["name"])
    for key in ("subclass", "subclassVariant"):
        for item in entry.get(key, []) or []:
            if isinstance(item, dict):
                name = (item.get("class") or {}).get("name")
                if name:
                    names.add(name)
    return sorted(names)


def _higher_levels(raw: dict[str, Any]) -> str:
    """The "At Higher Levels" rider, unwrapped from its named entry so it isn't double-titled."""
    entries = raw.get("entriesHigherLevel") or []
    unwrapped: list[Any] = []
    for entry in entries:
        if isinstance(entry, dict) and str(entry.get("name", "")).strip().lower() in (
            "at higher levels",
            "using a higher-level spell slot",
            "cantrip upgrade",
        ):
            unwrapped.extend(entry.get("entries") or [])
        else:
            unwrapped.append(entry)
    return entries_to_markdown(unwrapped)


def format_casting_time(times: list[Any]) -> str:
    parts = []
    for time in times:
        if not isinstance(time, dict):
            continue
        number = time.get("number", 1)
        unit = str(time.get("unit", ""))
        unit = "bonus action" if unit == "bonus" else unit
        label = f"{number} {_plural(unit, number)}"
        if time.get("condition"):
            label += f", {render_text(str(time['condition']))}"
        parts.append(label)
    return " or ".join(parts)


def format_range(rng: dict[str, Any]) -> str:
    kind = str(rng.get("type", ""))
    distance = rng.get("distance") or {}
    unit = str(distance.get("type", ""))
    amount = distance.get("amount")

    if kind == "special" or unit == "special":
        return "Special"
    if unit == "self":
        base = "Self"
    elif unit == "touch":
        base = "Touch"
    elif unit in ("sight", "unlimited"):
        base = unit.capitalize()
    elif amount is not None:
        base = f"{amount} {_plural(unit, amount)}"
    else:
        base = kind.capitalize()

    if kind in ("point", "", "special"):
        return base
    # Shaped areas always originate on the caster: "Self (15-foot radius)", "Self (cone)".
    if unit == "self" or amount is None:
        return f"Self ({kind})"
    return f"Self ({amount}-{_singular(unit)} {kind})"


def format_components(components: dict[str, Any]) -> str:
    parts = []
    if components.get("v"):
        parts.append("V")
    if components.get("s"):
        parts.append("S")
    if components.get("r"):
        parts.append("R")
    material = components.get("m")
    if isinstance(material, dict):
        material = material.get("text", "")
    if material:
        parts.append(f"M ({render_text(str(material))})" if material is not True else "M")
    return ", ".join(parts)


def format_duration(durations: list[Any]) -> str:
    parts = []
    for duration in durations:
        if not isinstance(duration, dict):
            continue
        kind = str(duration.get("type", ""))
        if kind == "instant":
            label = "Instantaneous"
        elif kind == "permanent":
            ends = duration.get("ends") or []
            wording = {"dispel": "dispelled", "trigger": "triggered", "discard": "discarded"}
            label = "Until " + " or ".join(wording.get(e, e) for e in ends) if ends else "Permanent"
        elif kind == "special":
            label = "Special"
        else:
            amount = (duration.get("duration") or {}).get("amount")
            unit = str((duration.get("duration") or {}).get("type", ""))
            label = f"{amount} {_plural(unit, amount)}" if amount is not None else unit
            if duration.get("concentration"):
                label = f"Concentration, up to {label}"
        parts.append(label)
    return " or ".join(parts)


def _plural(unit: str, count: Any) -> str:
    if not unit:
        return unit
    if count == 1:
        return _singular(unit)
    return {"feet": "feet", "foot": "feet"}.get(unit, unit + "s")


def _singular(unit: str) -> str:
    return {"feet": "foot", "miles": "mile"}.get(unit, unit)


# --- Items -------------------------------------------------------------------


def item_type_code(raw: dict[str, Any]) -> str:
    return strip_source(raw.get("type", "")).upper()


def item_category(raw: dict[str, Any]) -> str:
    """Bucket a 5etools item into one of the sheet's preset equipment categories."""
    code = item_type_code(raw)
    if code in _CATEGORY_BY_TYPE:
        return _CATEGORY_BY_TYPE[code]
    if raw.get("weapon") or raw.get("weaponCategory"):
        return "Weapons"
    if raw.get("armor"):
        return "Armor"
    return "Gear"


def is_weapon(raw: dict[str, Any]) -> bool:
    return bool(raw.get("weapon") or raw.get("weaponCategory")) or item_type_code(raw) in (
        "M",
        "R",
    )


def item_properties(raw: dict[str, Any], property_names: dict[str, str] | None = None) -> list[str]:
    names = property_names or {}
    out = []
    for prop in raw.get("property", []) or []:
        code = strip_source(prop).upper()
        if not code:
            continue
        label = names.get(code, code)
        if code == "V" and raw.get("dmg2"):
            label = f"{label} ({scalar(raw['dmg2'])})"
        if code == "T" and raw.get("range"):
            label = f"{label} ({scalar(raw['range'])} ft.)"
        out.append(label)
    return out


def format_value(copper: Any) -> str:
    """5etools stores prices in copper; show the tidiest denomination."""
    try:
        value = int(copper)
    except (TypeError, ValueError):
        return ""
    if value % 100 == 0:
        return f"{value // 100} gp"
    if value % 10 == 0:
        return f"{value // 10} sp"
    return f"{value} cp"


def attunement_text(raw: dict[str, Any]) -> str:
    req = raw.get("reqAttune")
    if not req:
        return ""
    if req is True:
        return "requires attunement"
    if str(req).lower() == "optional":
        return "attunement optional"
    return f"requires attunement {render_text(str(req))}"


def item_type_label(raw: dict[str, Any], type_names: dict[str, str] | None = None) -> str:
    code = item_type_code(raw)
    names = {**ITEM_TYPE_NAMES, **(type_names or {})}
    if code:
        return names.get(code, code)
    if raw.get("wondrous"):
        return "Wondrous Item"
    return ""


def item_facets(
    raw: dict[str, Any], type_names: dict[str, str] | None = None
) -> dict[str, Any]:
    rarity = str(raw.get("rarity", "") or "")
    label = item_type_label(raw, type_names)
    return {
        "category": item_category(raw),
        "rarity": rarity,
        "value": raw.get("value"),
        "weight": raw.get("weight"),
        "attunement": bool(raw.get("reqAttune")),
        "weapon": is_weapon(raw),
        "subtitle": " · ".join(
            filter(
                None,
                [
                    label,
                    rarity if rarity and rarity != "none" else "",
                    format_value(raw.get("value")),
                ],
            )
        ),
    }


def normalize_item(
    raw: dict[str, Any],
    type_names: dict[str, str] | None = None,
    property_names: dict[str, str] | None = None,
) -> dict[str, Any]:
    """A 5etools item → our ``EquipmentItem`` shape, description = stat block + prose."""
    return {
        "name": str(raw.get("name", "")),
        "quantity": 1,
        "category": item_category(raw),
        "weight": float(raw["weight"]) if raw.get("weight") is not None else None,
        "equipped": False,
        "attuned": False,
        "description": item_description(raw, type_names, property_names),
    }


def item_description(
    raw: dict[str, Any],
    type_names: dict[str, str] | None = None,
    property_names: dict[str, str] | None = None,
) -> str:
    """Markdown: an italic type/rarity header, a bulleted stat line, then the item's prose."""
    header_bits = [item_type_label(raw, type_names)]
    rarity = str(raw.get("rarity", "") or "")
    if rarity and rarity != "none":
        header_bits.append(rarity)
    header = ", ".join(bit for bit in header_bits if bit)
    attune = attunement_text(raw)
    if attune:
        header = f"{header} ({attune})" if header else attune.capitalize()

    stats: list[str] = []
    if raw.get("dmg1"):
        damage_type = DAMAGE_TYPES.get(strip_source(raw.get("dmgType")).upper(), "")
        stats.append(f"**Damage** {scalar(raw['dmg1'])} {damage_type}".strip())
    props = item_properties(raw, property_names)
    if props:
        stats.append(f"**Properties** {', '.join(props)}")
    if raw.get("range") and item_type_code(raw) == "R":
        stats.append(f"**Range** {scalar(raw['range'])} ft.")
    if raw.get("ac") is not None:
        armor_class = scalar(raw["ac"])
        if item_type_code(raw) == "MA":
            armor_class += " + Dex modifier (max 2)"
        elif item_type_code(raw) == "LA":
            armor_class += " + Dex modifier"
        elif item_type_code(raw) == "S":
            armor_class = f"+{raw['ac']}"
        stats.append(f"**Armor Class** {armor_class}")
    if raw.get("strength"):
        stats.append(f"**Strength** {scalar(raw['strength'])}")
    if raw.get("stealth"):
        stats.append("**Stealth** disadvantage")
    for key, label in (
        ("bonusWeapon", "attack and damage rolls"),
        ("bonusWeaponAttack", "attack rolls"),
        ("bonusWeaponDamage", "damage rolls"),
        ("bonusAc", "AC"),
        ("bonusSpellAttack", "spell attack rolls"),
        ("bonusSpellSaveDc", "spell save DC"),
        ("bonusSavingThrow", "saving throws"),
    ):
        if raw.get(key):
            stats.append(f"**Bonus** {scalar(raw[key])} to {label}")
    if raw.get("charges"):
        stats.append(f"**Charges** {scalar(raw['charges'])}")
    if raw.get("weight") is not None:
        stats.append(f"**Weight** {_trim_number(raw['weight'])} lb.")
    if raw.get("value") is not None:
        stats.append(f"**Value** {format_value(raw['value'])}")

    blocks = []
    if header:
        blocks.append(f"*{header}*")
    if stats:
        blocks.append("\n".join(f"- {stat}" for stat in stats))
    prose = entries_to_markdown(raw.get("entries") or [])
    if prose:
        blocks.append(prose)
    return "\n\n".join(blocks)


def weapon_attack(
    raw: dict[str, Any],
    type_names: dict[str, str] | None = None,
    property_names: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    """A weapon item → a ready-to-add ``Attack`` row (to-hit/damage stay server-derived)."""
    if not is_weapon(raw):
        return None
    codes = {strip_source(p).upper() for p in raw.get("property", []) or []}
    ranged = item_type_code(raw) == "R"
    if ranged:
        weapon_range = f"{raw['range']} ft." if raw.get("range") else "Ranged"
    elif "R" in codes:
        weapon_range = "10 ft."
    else:
        weapon_range = "5 ft."
    notes = item_properties(raw, property_names)
    return {
        "name": str(raw.get("name", "")),
        "ability": "dex" if ranged or "F" in codes else "str",
        "proficient": True,
        "spell_mod_damage": False,
        "damage_dice": scalar(raw.get("dmg1", "") or ""),
        "damage_type": DAMAGE_TYPES.get(strip_source(raw.get("dmgType")).upper(), ""),
        "bonus": int(raw["bonusWeapon"]) if _is_int(raw.get("bonusWeapon")) else None,
        "range": weapon_range,
        "notes": ", ".join(notes),
        "description": item_description(raw, type_names, property_names),
        "source": "weapon",
    }


def _is_int(value: Any) -> bool:
    try:
        int(value)
    except (TypeError, ValueError):
        return False
    return True


def _trim_number(value: Any) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else str(number)


# --- Features (feats + optional features) -------------------------------------


def normalize_feat(raw: dict[str, Any]) -> dict[str, Any]:
    return _feature(raw, source="feat")


def normalize_optional_feature(raw: dict[str, Any]) -> dict[str, Any]:
    # Invocations, metamagic, maneuvers, fighting styles… all come from a class.
    return _feature(raw, source="class")


def _feature(raw: dict[str, Any], source: str) -> dict[str, Any]:
    prerequisite = format_prerequisites(raw.get("prerequisite") or [])
    prose = entries_to_markdown(raw.get("entries") or [])
    description = f"*Prerequisite: {prerequisite}*\n\n{prose}" if prerequisite else prose
    return {
        "name": str(raw.get("name", "")),
        "source": source,
        "level": None,
        "uses": None,
        "description": description,
    }


def feature_facets(raw: dict[str, Any], kind: str) -> dict[str, Any]:
    prerequisite = format_prerequisites(raw.get("prerequisite") or [])
    return {
        "kind": kind,
        "subtitle": " · ".join(filter(None, [kind, prerequisite])),
    }


def optional_feature_kind(raw: dict[str, Any]) -> str:
    types = [strip_source(t) for t in raw.get("featureType", []) or []]
    labels = [OPTIONAL_FEATURE_KINDS.get(code, code) for code in types if code]
    return labels[0] if labels else "Optional Feature"


_ABILITY_NAMES = {
    "str": "Strength",
    "dex": "Dexterity",
    "con": "Constitution",
    "int": "Intelligence",
    "wis": "Wisdom",
    "cha": "Charisma",
}


def format_prerequisites(prerequisites: list[Any]) -> str:
    """5etools prerequisites: a list of alternatives, each an object of ANDed conditions."""
    alternatives = [
        _prerequisite(entry) for entry in prerequisites if isinstance(entry, dict)
    ]
    return " or ".join(alt for alt in alternatives if alt)


def _prerequisite(entry: dict[str, Any]) -> str:
    parts: list[str] = []
    for key, value in entry.items():
        if key == "level":
            level = value.get("level") if isinstance(value, dict) else value
            klass = (value.get("class") or {}).get("name") if isinstance(value, dict) else None
            parts.append(f"{klass} level {level}" if klass else f"level {level}")
        elif key == "ability":
            for option in value:
                parts.extend(
                    f"{_ABILITY_NAMES.get(ability, ability)} {score}"
                    for ability, score in option.items()
                )
        elif key == "race":
            parts.append(
                " or ".join(
                    " ".join(filter(None, [r.get("subrace", ""), r.get("name", "")])).strip()
                    for r in value
                )
            )
        elif key in ("spellcasting", "spellcasting2020", "spellcastingFeature"):
            parts.append("the ability to cast at least one spell")
        elif key == "pact":
            parts.append(f"Pact of the {value}")
        elif key == "patron":
            parts.append(f"{value} patron")
        elif key == "proficiency":
            for option in value:
                parts.extend(f"{kind} {name} proficiency" for kind, name in option.items())
        elif key == "spell":
            parts.append(
                " or ".join(_prereq_name(item).split("#")[0].title() for item in value) + " spell"
            )
        elif key in ("feat", "feature", "optionalfeature", "item", "background", "campaign"):
            parts.append(" or ".join(_prereq_name(item) for item in _as_list(value)))
        elif key == "alignment":
            parts.append(" ".join(str(a) for a in _as_list(value)))
        elif key == "other":
            parts.append(render_text(str(value)))
        elif key == "otherSummary":
            parts.append(render_text(str(value.get("entrySummary", value.get("entry", "")))))
        elif key not in ("level", "note"):
            parts.append(f"{key} {value}")
    return ", ".join(part for part in parts if part)


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else [value]


def _prereq_name(item: Any) -> str:
    if isinstance(item, dict):
        item = item.get("name", "")
    return render_text(str(item).split("|", 1)[0])


# --- Item assembly (`_copy` + magic variants) ---------------------------------


def resolve_copies(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fill in items declared as a ``_copy`` of another item.

    Only plain field inheritance is applied — 5etools' ``_mod`` patch language (array
    splices, string replacements) is deliberately not implemented; the copied fields are
    enough to name, categorize and describe the item.
    """
    by_key = {(i.get("name", ""), i.get("source", "")): i for i in items if "_copy" not in i}
    resolved = []
    for item in items:
        copy = item.get("_copy")
        if not isinstance(copy, dict):
            resolved.append(item)
            continue
        parent = by_key.get((copy.get("name", ""), copy.get("source", "")))
        merged = {**parent, **item} if parent else dict(item)
        merged.pop("_copy", None)
        merged.pop("_mod", None)
        resolved.append(merged)
    return resolved


# Keys of `inherits` that shape the *name* rather than the item's own fields.
_NAME_KEYS = {"namePrefix", "nameSuffix", "nameRemove", "nameAdditionalEntries"}


def expand_magic_variants(
    base_items: list[dict[str, Any]], variants: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Cross ``magicvariants.json`` with the base items it applies to.

    5etools has no "+1 Longsword" record — it has a "+1 Weapon" variant plus the rule that it
    applies to any base item matching ``requires`` (and not ``excludes``). This produces the
    specific items so they can be searched by the name a player would type.
    """
    out = []
    for variant in variants:
        for base in base_items:
            if _variant_applies(base, variant):
                out.append(build_variant(base, variant))
    return out


def _variant_applies(base: dict[str, Any], variant: dict[str, Any]) -> bool:
    requires = variant.get("requires") or []
    excludes = variant.get("excludes") or {}
    if requires and not any(_matches(base, req) for req in requires if isinstance(req, dict)):
        return False
    return not (excludes and _matches(base, excludes, any_of=True))


def _matches(base: dict[str, Any], spec: dict[str, Any], any_of: bool = False) -> bool:
    """``requires``: every key must match. ``excludes``: any matching key disqualifies."""
    results = [_matches_key(base.get(key), value) for key, value in spec.items()]
    if not results:
        return False
    return any(results) if any_of else all(results)


def _matches_key(actual: Any, expected: Any) -> bool:
    if isinstance(actual, list):
        codes = {strip_source(a).upper() for a in actual}
        wanted = {strip_source(e).upper() for e in _as_list(expected)}
        return bool(codes & wanted)
    if isinstance(expected, list):
        return any(_matches_key(actual, option) for option in expected)
    if isinstance(actual, str) and isinstance(expected, str):
        return strip_source(actual).upper() == strip_source(expected).upper()
    return actual == expected


def build_variant(base: dict[str, Any], variant: dict[str, Any]) -> dict[str, Any]:
    """Merge one magic variant onto one base item, resolving ``{=field}`` templating."""
    inherits = variant.get("inherits") or {}
    merged = {**base, **{k: v for k, v in inherits.items() if k not in _NAME_KEYS}}
    merged.pop("_copy", None)
    merged.pop("_mod", None)

    name = str(base.get("name", ""))
    if inherits.get("nameRemove"):
        name = name.replace(str(inherits["nameRemove"]), "").strip()
    name = f"{inherits.get('namePrefix', '')}{name}{inherits.get('nameSuffix', '')}".strip()
    merged["name"] = name
    merged["source"] = inherits.get("source", variant.get("source", base.get("source", "")))
    merged["baseItem"] = f"{base.get('name', '')}|{base.get('source', '')}"
    # The variant's prose is the interesting part; keep the base item's below it if it had any.
    entries = list(inherits.get("entries") or [])
    if base.get("entries") and inherits.get("entries"):
        entries = [*entries, *base["entries"]]
    merged["entries"] = entries or base.get("entries") or []

    values = {**base, **merged, "baseName": base.get("name", "")}
    return _substitute(merged, values)


_TEMPLATE_RE = re.compile(r"\{=(\w+)((?:/\w+)*)\}")


def _substitute(node: Any, values: dict[str, Any]) -> Any:
    """Resolve 5etools' ``{=field}`` / ``{=field/l}`` templating throughout a structure."""
    if isinstance(node, str):
        return _TEMPLATE_RE.sub(lambda m: _template_value(m, values), node)
    if isinstance(node, list):
        return [_substitute(item, values) for item in node]
    if isinstance(node, dict):
        return {key: _substitute(value, values) for key, value in node.items()}
    return node


def _template_value(match: re.Match[str], values: dict[str, Any]) -> str:
    key, modifiers = match.group(1), match.group(2)
    value = values.get(key, "")
    if key in ("dmgType", "dmgType1", "dmgType2"):
        value = DAMAGE_TYPES.get(strip_source(value).upper(), value)
    text = str(value)
    for modifier in filter(None, modifiers.split("/")):
        if modifier == "l":
            text = text.lower()
        elif modifier == "u":
            text = text.upper()
        elif modifier == "t":
            text = text.title()
        elif modifier == "a":
            text = ("an " if text[:1].lower() in "aeiou" else "a ") + text
    return text
