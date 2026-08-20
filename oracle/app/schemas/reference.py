"""Schemas for the 5etools reference browser (Phase 13).

A *summary* is what the browser lists (identity + the facets it filters/sorts on); a *record*
is the full, sheet-shaped payload that gets imported into a character's equipment / spells /
features / attacks. Both are read-only projections of user-supplied reference data.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.character import Attack, EquipmentItem, Feature, Spell

ReferenceType = Literal["spell", "item", "feature"]


class ReferenceStatus(BaseModel):
    """Whether reference import is usable at all — herald hides its Browse buttons when not."""

    available: bool
    counts: dict[str, int] = {}
    # Set when the dataset comes from the user's own FIVETOOLS_DATA_DIR rather than a download;
    # herald uses it to explain why the Download button isn't offered.
    configured_dir: str = ""


class ReferenceFetchStatus(BaseModel):
    """Progress of the optional one-shot dataset download."""

    state: Literal["idle", "running", "done", "error"]
    downloaded: int = 0
    total: int = 0
    current: str = ""
    message: str = ""
    dest: str = ""
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ReferenceFacets(BaseModel):
    """Filter values actually present in the loaded dataset, plus the valid sort fields."""

    type: ReferenceType
    sorts: list[str] = []
    sources: list[str] = []
    # Spells
    levels: list[int] = []
    schools: list[str] = []
    classes: list[str] = []
    # Items
    categories: list[str] = []
    rarities: list[str] = []
    # Features
    kinds: list[str] = []


class ReferenceSummary(BaseModel):
    """One row in the browser. Facets are flat so both ends stay simple and typed."""

    id: str
    type: ReferenceType
    name: str
    source: str
    subtitle: str = ""
    # Spell facets
    level: int | None = None
    school: str = ""
    classes: list[str] = []
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


class ReferenceSearchResponse(BaseModel):
    total: int
    results: list[ReferenceSummary]


class ReferenceRecord(BaseModel):
    """A full record: exactly one of the payloads is set, plus ``attack`` for weapons.

    The payloads are the sheet's own models, so importing is a straight assignment — and the
    imported entry stays fully editable afterwards.
    """

    id: str
    type: ReferenceType
    name: str
    source: str
    subtitle: str = ""
    spell: Spell | None = None
    item: EquipmentItem | None = None
    feature: Feature | None = None
    attack: Attack | None = None
