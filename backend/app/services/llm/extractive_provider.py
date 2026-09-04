"""Offline, deterministic LLM provider.

Dispatches each :class:`LLMTask` to the corresponding routine in
:mod:`app.services.llm.extractive_engine`. Requires no network and no API key,
so the full evaluation harness is reproducible on any machine.
"""

from __future__ import annotations

import json
from typing import Any

from . import extractive_engine as engine
from .base import LLMProvider, LLMRequest, LLMResponse, LLMTask, estimate_tokens


class ExtractiveProvider(LLMProvider):
    name = "extractive"
    model = "deterministic-grounded-v1"
    deterministic = True

    def generate(self, request: LLMRequest) -> LLMResponse:
        payload = request.payload or {}
        handler = {
            LLMTask.answer: self._answer,
            LLMTask.revise: self._answer,
            LLMTask.extract_claims: self._extract_claims,
            LLMTask.rewrite_query: self._rewrite_query,
            LLMTask.reflect: self._reflect,
            LLMTask.retrieval_decision: self._retrieval_decision,
        }.get(request.task)

        if handler is None:  # pragma: no cover - defensive
            raise ValueError(f"Unsupported task for ExtractiveProvider: {request.task}")

        structured = handler(payload)
        text = structured.get("answer") or json.dumps(structured, ensure_ascii=False)
        prompt_chars = sum(
            len(str(item.get("text", ""))) for item in payload.get("evidence", [])
        ) + len(str(payload.get("query", "")))

        return LLMResponse(
            text=text,
            prompt_tokens=estimate_tokens("x" * prompt_chars),
            completion_tokens=estimate_tokens(text),
            provider=self.name,
            model=self.model,
            structured=structured,
        )

    # ------------------------------------------------------------------ tasks
    def _answer(self, payload: dict[str, Any]) -> dict[str, Any]:
        return engine.compose_answer(
            query=payload.get("query", ""),
            evidence=payload.get("evidence", []),
            focus_terms=payload.get("focus_terms", ()),
            avoid_claims=payload.get("avoid_claims", ()),
            include_lead=payload.get("include_lead", True),
            max_sentences=payload.get("max_sentences", engine.MAX_SUPPORTING_SENTENCES),
        )

    def _extract_claims(self, payload: dict[str, Any]) -> dict[str, Any]:
        claims = engine.extract_claims(
            payload.get("answer", ""), max_claims=payload.get("max_claims", 12)
        )
        return {"claims": claims}

    def _rewrite_query(self, payload: dict[str, Any]) -> dict[str, Any]:
        rewrites = engine.rewrite_queries(
            query=payload.get("query", ""),
            keywords=payload.get("keywords", ()),
            entities=payload.get("entities", ()),
            uncovered_terms=payload.get("uncovered_terms", ()),
            corpus_terms=payload.get("corpus_terms", ()),
            limit=payload.get("limit", 3),
        )
        return {"rewrites": rewrites}

    def _reflect(self, payload: dict[str, Any]) -> dict[str, Any]:
        return engine.reflect(
            answer=payload.get("answer", ""),
            evidence=payload.get("evidence", []),
            query=payload.get("query", ""),
        )

    def _retrieval_decision(self, payload: dict[str, Any]) -> dict[str, Any]:
        # The heuristic analyser owns this decision; the provider simply echoes
        # it so hosted providers can override the behaviour later.
        return {
            "needs_retrieval": bool(payload.get("needs_retrieval", True)),
            "reason": payload.get("reason", "document-grounded question"),
        }
