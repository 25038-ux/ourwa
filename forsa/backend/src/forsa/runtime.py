"""Composition root: builds the long-lived collaborators once per process."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from forsa.ai.factory import build_gateway
from forsa.ai.gateway import AIGateway
from forsa.ingestion.registry import SourceRecord, load_registry
from forsa.ingestion.storage import LocalObjectStore, ObjectStore
from forsa.matching.engine import MatchingEngine
from forsa.settings import Settings, get_settings
from forsa.taxonomy.ontology import Ontology, default_ontology


@dataclass
class Runtime:
    settings: Settings
    store: ObjectStore
    ontology: Ontology
    engine: MatchingEngine
    gateway: AIGateway
    registry: dict[str, SourceRecord]


@lru_cache(maxsize=1)
def get_runtime() -> Runtime:
    settings = get_settings()
    onto = default_ontology()
    return Runtime(
        settings=settings,
        store=LocalObjectStore(settings.storage_dir),
        ontology=onto,
        engine=MatchingEngine(onto),
        gateway=build_gateway(settings),
        registry=load_registry(settings.source_registry),
    )
