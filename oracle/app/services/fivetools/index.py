"""The 5etools reference index — the only part of this package that touches the filesystem.

The dataset is **user-supplied and never bundled** (see `docs/architecture.md`): the user
mounts their own copy and points ``FIVETOOLS_DATA_DIR`` at it. When that is unset or missing,
:func:`get_index` raises :class:`ReferenceUnavailable` and the router turns that into a 503 —
the character sheet keeps working, it just has nothing to import from.

**The data is read once.** ``_build`` is ``lru_cache``d on the resolved directory, so the JSON
is parsed and indexed on the first request (or at startup via :func:`warm`) and every later
search hits the in-memory index. Records are kept **raw**; the expensive part — rendering
``entries`` into Markdown — happens per record in :func:`get_record`.
"""

import json
import re
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import get_settings

from . import normalize

REFERENCE_TYPES = ("spell", "item", "feature")

# `oracle/` — index.py → fivetools → services → app → oracle. Relative download paths and the
# Docker WORKDIR both resolve against it, so dev and container agree.
_ORACLE_ROOT = Path(__file__).resolve().parents[3]

SORT_FIELDS: dict[str, tuple[str, ...]] = {
    "spell": ("relevance", "name", "level", "school", "source"),
    "item": ("relevance", "name", "category", "rarity", "value", "weight", "source"),
    "feature": ("relevance", "name", "kind", "source"),
}


class ReferenceUnavailable(RuntimeError):
    """Raised when no usable 5etools dataset is configured."""


@dataclass(frozen=True)
class ReferenceEntry:
    """One searchable record: identity + the facets we filter/sort on + the raw 5etools object."""

    id: str
    type: str
    name: str
    source: str
    subtitle: str = ""
    # Spell facets
    level: int | None = None
    school: str = ""
    classes: tuple[str, ...] = ()
    ritual: bool = False
    concentration: bool = False
    # Item facets
    category: str = ""
    rarity: str = ""
    value: int | None = None
    weight: float | None = None
    attunement: bool = False
    weapon: bool = False
    # Feature facets
    kind: str = ""
    raw: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @property
    def sort_name(self) -> str:
        return self.name.lower()


@dataclass
class ReferenceIndex:
    """Everything loaded from one dataset directory, ready to query."""

    data_dir: Path
    by_type: dict[str, list[ReferenceEntry]]
    by_id: dict[str, ReferenceEntry]
    item_type_names: dict[str, str]
    item_property_names: dict[str, str]

    def counts(self) -> dict[str, int]:
        return {kind: len(self.by_type.get(kind, [])) for kind in REFERENCE_TYPES}


@dataclass
class SearchQuery:
    """Filters for one reference search; unset fields simply don't filter."""

    type: str
    q: str = ""
    sort: str = ""
    direction: str = "asc"
    limit: int = 50
    offset: int = 0
    # Spells
    level: list[int] = field(default_factory=list)
    school: str = ""
    class_name: str = ""
    ritual: bool | None = None
    concentration: bool | None = None
    # Items
    category: str = ""
    rarity: str = ""
    attunement: bool | None = None
    weapons_only: bool = False
    # Features
    kind: str = ""


# --- Loading -----------------------------------------------------------------

_build_lock = threading.Lock()


def configured_data_dir() -> str:
    """The user's own dataset path, if they set one (``FIVETOOLS_DATA_DIR``)."""
    return (get_settings().fivetools_data_dir or "").strip()


def download_dir() -> Path:
    """Where `POST /api/reference/fetch` saves a dataset. Relative paths hang off `oracle/`."""
    configured = Path((get_settings().fivetools_download_dir or "var/fivetools").strip())
    # index.py → fivetools → services → app → oracle
    return configured if configured.is_absolute() else _ORACLE_ROOT / configured


def get_index() -> ReferenceIndex:
    """The loaded-once index, or raise ``ReferenceUnavailable``.

    Your own copy (``FIVETOOLS_DATA_DIR``) always wins; otherwise a dataset downloaded by the
    fetch endpoint is used, so the feature can be set up entirely from the UI.
    """
    configured = configured_data_dir()
    if configured:
        data_dir = _resolve_data_dir(Path(configured))
        if data_dir is None:
            raise ReferenceUnavailable(f"5etools data directory not found or empty: {configured}")
    else:
        data_dir = _resolve_data_dir(download_dir())
        if data_dir is None:
            raise ReferenceUnavailable(
                "5etools reference data is not available — download it from the campaigns page, "
                "or point FIVETOOLS_DATA_DIR at your own copy."
            )
    with _build_lock:
        return _build(str(data_dir))


def is_available() -> bool:
    try:
        get_index()
    except ReferenceUnavailable:
        return False
    return True


def warm() -> None:
    """Preload the index (called at startup) so the first search isn't the one that pays."""
    try:
        get_index()
    except ReferenceUnavailable:
        pass


def reset_cache() -> None:
    """Drop the loaded dataset — used by tests that point at different fixture dirs."""
    _build.cache_clear()


def _resolve_data_dir(path: Path) -> Path | None:
    """Accept either the 5etools repo root or its ``data/`` directory."""
    for candidate in (path, path / "data"):
        if candidate.is_dir() and any(
            (candidate / name).exists()
            for name in ("spells", "items.json", "items-base.json", "feats.json")
        ):
            return candidate.resolve()
    return None


@lru_cache(maxsize=4)
def _build(data_dir: str) -> ReferenceIndex:
    root = Path(data_dir)
    type_names, property_names = _load_item_metadata(root)
    entries: list[ReferenceEntry] = []
    entries.extend(_index_spells(root))
    entries.extend(_index_items(root, type_names))
    entries.extend(_index_features(root))

    by_type: dict[str, list[ReferenceEntry]] = {kind: [] for kind in REFERENCE_TYPES}
    by_id: dict[str, ReferenceEntry] = {}
    for entry in entries:
        by_type[entry.type].append(entry)
        by_id[entry.id] = entry
    for bucket in by_type.values():
        bucket.sort(key=lambda e: e.sort_name)
    return ReferenceIndex(
        data_dir=root,
        by_type=by_type,
        by_id=by_id,
        item_type_names=type_names,
        item_property_names=property_names,
    )


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        with path.open(encoding="utf-8") as handle:
            loaded = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _make_id(kind: str, name: str, source: str, seen: set[str]) -> str:
    slug = _SLUG_RE.sub("-", f"{name} {source}".lower()).strip("-")
    candidate = f"{kind}-{slug}" if slug else f"{kind}-unnamed"
    suffix = 2
    while candidate in seen:
        candidate = f"{kind}-{slug}-{suffix}"
        suffix += 1
    seen.add(candidate)
    return candidate


def _index_spells(root: Path) -> list[ReferenceEntry]:
    listing = _read_json(root / "spells" / "index.json")
    # Newer datasets keep the spell→class mapping in a separate file, keyed by source.
    class_sources = _read_json(root / "spells" / "sources.json")
    seen: set[str] = set()
    entries: list[ReferenceEntry] = []
    for source, filename in sorted(listing.items()):
        for raw in _read_json(root / "spells" / filename).get("spell", []):
            if not isinstance(raw, dict) or not raw.get("name"):
                continue
            classes = normalize.spell_classes(raw)
            if not classes:
                lookup = (class_sources.get(raw.get("source", source)) or {}).get(raw["name"])
                if isinstance(lookup, dict):
                    classes = normalize.classes_from_sources(lookup)
            facets = normalize.spell_facets(raw, classes)
            spell_source = str(raw.get("source", source))
            entries.append(
                ReferenceEntry(
                    id=_make_id("spell", raw["name"], spell_source, seen),
                    type="spell",
                    name=str(raw["name"]),
                    source=spell_source,
                    subtitle=facets["subtitle"],
                    level=facets["level"],
                    school=facets["school"],
                    classes=tuple(facets["classes"]),
                    ritual=facets["ritual"],
                    concentration=facets["concentration"],
                    raw=raw,
                )
            )
    return entries


def _load_item_metadata(root: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Item type + property abbreviations → readable names, straight from the dataset."""
    base = _read_json(root / "items-base.json")
    type_names: dict[str, str] = {}
    for item_type in base.get("itemType", []):
        code = normalize.strip_source(item_type.get("abbreviation", "")).upper()
        name = item_type.get("name") or _first_entry_name(item_type)
        if code and name:
            type_names[code] = str(name)
    property_names: dict[str, str] = {}
    for prop in base.get("itemProperty", []):
        code = normalize.strip_source(prop.get("abbreviation", "")).upper()
        name = prop.get("name") or _first_entry_name(prop)
        if code and name:
            property_names[code] = str(name)
    return type_names, property_names


def _first_entry_name(record: dict[str, Any]) -> str:
    for entry in record.get("entries", []):
        if isinstance(entry, dict) and entry.get("name"):
            return str(entry["name"])
    return ""


def _index_items(root: Path, type_names: dict[str, str]) -> list[ReferenceEntry]:
    base_file = _read_json(root / "items-base.json")
    items_file = _read_json(root / "items.json")
    variants_file = _read_json(root / "magicvariants.json")

    base_items = [i for i in base_file.get("baseitem", []) if isinstance(i, dict)]
    magic_items = [i for i in items_file.get("item", []) if isinstance(i, dict)]
    magic_items += [i for i in items_file.get("itemGroup", []) if isinstance(i, dict)]
    variants = [v for v in variants_file.get("magicvariant", []) if isinstance(v, dict)]

    raws = normalize.resolve_copies(base_items + magic_items)
    raws += normalize.expand_magic_variants(base_items, variants)

    seen: set[str] = set()
    entries = []
    for raw in raws:
        if not raw.get("name"):
            continue
        facets = normalize.item_facets(raw, type_names)
        source = str(raw.get("source", ""))
        entries.append(
            ReferenceEntry(
                id=_make_id("item", raw["name"], source, seen),
                type="item",
                name=str(raw["name"]),
                source=source,
                subtitle=facets["subtitle"],
                category=facets["category"],
                rarity=facets["rarity"],
                value=facets["value"],
                weight=facets["weight"],
                attunement=facets["attunement"],
                weapon=facets["weapon"],
                raw=raw,
            )
        )
    return entries


def _index_features(root: Path) -> list[ReferenceEntry]:
    seen: set[str] = set()
    entries = []
    for raw in _read_json(root / "feats.json").get("feat", []):
        if isinstance(raw, dict) and raw.get("name"):
            entries.append(_feature_entry(raw, "Feat", seen))
    for raw in _read_json(root / "optionalfeatures.json").get("optionalfeature", []):
        if isinstance(raw, dict) and raw.get("name"):
            entries.append(_feature_entry(raw, normalize.optional_feature_kind(raw), seen))
    return entries


def _feature_entry(raw: dict[str, Any], kind: str, seen: set[str]) -> ReferenceEntry:
    facets = normalize.feature_facets(raw, kind)
    source = str(raw.get("source", ""))
    return ReferenceEntry(
        id=_make_id("feature", raw["name"], source, seen),
        type="feature",
        name=str(raw["name"]),
        source=source,
        subtitle=facets["subtitle"],
        kind=facets["kind"],
        raw=raw,
    )


# --- Querying ----------------------------------------------------------------


def search(index: ReferenceIndex, query: SearchQuery) -> tuple[int, list[ReferenceEntry]]:
    """Filter → sort → page. Returns the total match count alongside the page."""
    needle = query.q.strip().lower()
    matches = [e for e in index.by_type.get(query.type, []) if _matches(e, query, needle)]
    matches.sort(key=_sort_key(query, needle), reverse=query.direction == "desc")
    offset = max(0, query.offset)
    return len(matches), matches[offset : offset + max(0, query.limit)]


def _matches(entry: ReferenceEntry, query: SearchQuery, needle: str) -> bool:
    if needle and needle not in entry.name.lower():
        return False
    if query.level and entry.level not in query.level:
        return False
    if query.school and entry.school != query.school:
        return False
    if query.class_name and query.class_name not in entry.classes:
        return False
    if query.ritual is not None and entry.ritual != query.ritual:
        return False
    if query.concentration is not None and entry.concentration != query.concentration:
        return False
    if query.category and entry.category != query.category:
        return False
    if query.rarity and entry.rarity != query.rarity:
        return False
    if query.attunement is not None and entry.attunement != query.attunement:
        return False
    if query.weapons_only and not entry.weapon:
        return False
    return not (query.kind and entry.kind != query.kind)


def _sort_key(query: SearchQuery, needle: str):
    sort = query.sort or "relevance"
    if sort == "relevance":
        # Prefix hits first, then whole-word hits, then the rest — alphabetical within each.
        def key(entry: ReferenceEntry):
            return (_relevance(entry.sort_name, needle), entry.sort_name)
    elif sort == "level":
        def key(entry: ReferenceEntry):
            return (entry.level if entry.level is not None else 99, entry.sort_name)
    elif sort == "rarity":
        def key(entry: ReferenceEntry):
            rarity = (entry.rarity or "none").lower()
            order = normalize.RARITY_ORDER.index(rarity) if rarity in normalize.RARITY_ORDER else 99
            return (order, entry.sort_name)
    elif sort == "value":
        def key(entry: ReferenceEntry):
            return (entry.value if entry.value is not None else -1, entry.sort_name)
    elif sort == "weight":
        def key(entry: ReferenceEntry):
            return (entry.weight if entry.weight is not None else -1.0, entry.sort_name)
    elif sort in ("school", "category", "kind", "source"):
        def key(entry: ReferenceEntry):
            return (str(getattr(entry, sort) or "").lower(), entry.sort_name)
    else:
        def key(entry: ReferenceEntry):
            return (entry.sort_name, entry.sort_name)

    return key


def _relevance(name: str, needle: str) -> int:
    if not needle:
        return 0
    if name.startswith(needle):
        return 0
    return 1 if re.search(rf"\b{re.escape(needle)}", name) else 2


def facets(index: ReferenceIndex, kind: str) -> dict[str, list[Any]]:
    """Distinct filter values actually present in the dataset, for the browser's controls."""
    entries = index.by_type.get(kind, [])
    result: dict[str, list[Any]] = {
        "sorts": list(SORT_FIELDS.get(kind, ("relevance", "name"))),
        "sources": sorted({e.source for e in entries if e.source}),
    }
    if kind == "spell":
        result["levels"] = sorted({e.level for e in entries if e.level is not None})
        result["schools"] = sorted({e.school for e in entries if e.school})
        result["classes"] = sorted({c for e in entries for c in e.classes})
    elif kind == "item":
        result["categories"] = sorted({e.category for e in entries if e.category})
        result["rarities"] = sorted(
            {e.rarity for e in entries if e.rarity},
            key=lambda r: normalize.RARITY_ORDER.index(r)
            if r in normalize.RARITY_ORDER
            else len(normalize.RARITY_ORDER),
        )
    elif kind == "feature":
        result["kinds"] = sorted({e.kind for e in entries if e.kind})
    return result


def get_entry(index: ReferenceIndex, record_id: str) -> ReferenceEntry | None:
    return index.by_id.get(record_id)


def normalized_record(index: ReferenceIndex, entry: ReferenceEntry) -> dict[str, Any]:
    """The full, sheet-shaped record for one entry — this is where Markdown gets rendered."""
    record: dict[str, Any] = {
        "id": entry.id,
        "type": entry.type,
        "name": entry.name,
        "source": entry.source,
        "subtitle": entry.subtitle,
        "spell": None,
        "item": None,
        "feature": None,
        "attack": None,
    }
    if entry.type == "spell":
        spell = normalize.normalize_spell(entry.raw, list(entry.classes))
        spell.pop("_classes", None)
        record["spell"] = spell
    elif entry.type == "item":
        record["item"] = normalize.normalize_item(
            entry.raw, index.item_type_names, index.item_property_names
        )
        record["attack"] = normalize.weapon_attack(
            entry.raw, index.item_type_names, index.item_property_names
        )
    else:
        record["feature"] = (
            normalize.normalize_feat(entry.raw)
            if entry.kind == "Feat"
            else normalize.normalize_optional_feature(entry.raw)
        )
    return record
