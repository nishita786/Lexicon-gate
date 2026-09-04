"""Shared fixtures. Each test gets an isolated data directory."""

from __future__ import annotations

import pytest

from app.config import Settings, get_settings
from app.evaluation.dataset import load_demo_corpus
from app.services.embeddings.lsa_provider import LsaEmbeddingProvider
from app.services.llm.extractive_provider import ExtractiveProvider
from app.services.store.knowledge_base import KnowledgeBase
from app.services.vectorstore.numpy_store import NumpyVectorStore


@pytest.fixture
def settings(tmp_path, monkeypatch) -> Settings:
    data = tmp_path / "data"
    monkeypatch.setenv("SELFRAG_DATA_DIR", str(data))
    monkeypatch.setenv("SELFRAG_LLM_PROVIDER", "extractive")
    monkeypatch.setenv("SELFRAG_EMBEDDING_PROVIDER", "lsa")
    monkeypatch.setenv("SELFRAG_VECTOR_STORE", "numpy")
    get_settings.cache_clear()
    cfg = Settings(
        data_dir=data,
        upload_dir=data / "uploads",
        index_dir=data / "index",
        results_dir=data / "results",
        demo_dir=data / "demo",
        llm_provider="extractive",
        embedding_provider="lsa",
        vector_store="numpy",
    )
    cfg.ensure_dirs()
    return cfg


@pytest.fixture
def llm() -> ExtractiveProvider:
    return ExtractiveProvider()


@pytest.fixture
def kb(settings) -> KnowledgeBase:
    embedder = LsaEmbeddingProvider(settings)
    vectors = NumpyVectorStore(settings, namespace="test")
    store_kb = KnowledgeBase(settings=settings, embedder=embedder, vector_store=vectors)
    return store_kb


@pytest.fixture
def demo_kb(kb) -> KnowledgeBase:
    load_demo_corpus(kb, reset=True)
    return kb
