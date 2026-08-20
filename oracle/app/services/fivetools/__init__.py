"""5etools reference import (Phase 13).

Three sub-modules, split the way `character_calc` is split from the routers that use it:

- :mod:`.render`     — PURE: ``{@tag}`` markup + ``entries`` arrays → Markdown.
- :mod:`.normalize`  — PURE: 5etools objects → our sheet schemas, magic-variant assembly.
- :mod:`.index`      — the only IO: loads the dataset **once** into a searchable in-memory index.
- :mod:`.fetch`      — the optional one-shot download that *produces* a dataset (background job).

The dataset is user-supplied and never bundled: point ``FIVETOOLS_DATA_DIR`` at your own copy,
or have `POST /api/reference/fetch` download one into the local download dir. With neither,
every entry point raises :class:`ReferenceUnavailable`, which the router maps to a 503.
"""

from .fetch import FetchError, FetchStatus, fetch_dataset, job
from .index import (
    REFERENCE_TYPES,
    SORT_FIELDS,
    ReferenceEntry,
    ReferenceIndex,
    ReferenceUnavailable,
    SearchQuery,
    configured_data_dir,
    download_dir,
    facets,
    get_entry,
    get_index,
    is_available,
    normalized_record,
    reset_cache,
    search,
    warm,
)
from .normalize import normalize_feat, normalize_item, normalize_spell, weapon_attack
from .render import entries_to_markdown, render_text
