"""LLM provider defaults and model fallbacks (no network)."""

from app.services.investigator_llm import _llm_unavailable_message, _model_candidates


def test_groq_model_candidates_include_oss_fallback():
    models = _model_candidates("https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b")
    assert models[0] == "openai/gpt-oss-120b"
    assert "openai/gpt-oss-20b" in models


def test_gemini_model_candidates_still_supported():
    models = _model_candidates(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "gemini-3.5-flash",
    )
    assert "gemini-flash-latest" in models


def test_unavailable_message_points_at_groq_keys(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "llm_enabled", True)
    monkeypatch.setattr(settings, "llm_base_url", "https://api.groq.com/openai/v1")
    monkeypatch.setattr(settings, "llm_model", "openai/gpt-oss-120b")
    msg = _llm_unavailable_message()
    assert "console.groq.com/keys" in msg
    assert "Groq" in msg
