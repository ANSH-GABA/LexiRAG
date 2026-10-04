# ─────────────────────────────────────────────────────────────────
# src/llm.py
#
# WHAT THIS FILE DOES:
#   1. Connects to Google's Gemini API via LangChain ChatGoogleGenerativeAI
#   2. Houses advanced RAG prompting rules (LexiPrompts class)
#   3. Handles history-aware query rephrasing and grounded generation
# ─────────────────────────────────────────────────────────────────

import os
import time
from typing import Any, Optional, List, Dict

from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI

# Load variables from .env
load_dotenv()

# ── Constants ────────────────────────────────────────────────────
DEFAULT_MODEL = "gemini-3.8-flash"
MAX_RETRIES = 3


# ── Consolidated Prompt Factory ──────────────────────────────────
class LexiPrompts:
    @staticmethod
    def get_grounded_rag_prompt(query: str, context_str: str) -> str:
        """
        Step 1 & Step 6 Core Prompt Structure Rules.
        Combines strict evidence rules, formatting controls, and fallback responses.
        """
        return (
            "You are a professional Document AI Assistant. Answer the question using ONLY the provided context below.\n"
            "STRICT RULES:\n"
            "1. Every claim you make must use inline bracketed citations linking back to the source document name, e.g., 'The net profits scaled by 14% [annual_report.pdf, P. 3]'.\n"
            "2. At the very end of your answer, generate a markdown section header titled '### 📎 Verbatim Supporting Passages' listing the exact 1-2 sentences you relied upon.\n"
            "3. If the context is empty or missing relevant details, explicitly respond with: 'The information is not available in the provided documents.' Do not invent or extrapolate details.\n"
            "4. If the user asks in Hindi, respond in Hindi while keeping all structural rules.\n\n"
            f"=== CONTEXT ===\n{context_str}\n===============\n\n"
            f"Question: {query}\n"
            "Grounded Response:"
        )

    @staticmethod
    def get_reformulation_prompt(chat_history: List[Dict[str, str]], follow_up_query: str) -> str:
        """
        Step 5 History Conversational Query Condensation.
        Condenses a conversational context string down into a stateless keyword block.
        """
        history_str = "\n".join([f"{m.get('role', 'user')}: {m.get('content', '')}" for m in chat_history])
        return (
            "Given the following chat history and a new follow-up question, rewrite it into a single standalone search query (in the original language).\n"
            "Do NOT answer the question. Just output the clean text string for the standalone search query.\n\n"
            f"=== CHAT HISTORY ===\n{history_str}\n====================\n\n"
            f"Follow-up Question: {follow_up_query}\n"
            "Standalone Query:"
        )


# ── Initialize Gemini ────────────────────────────────────────────
def get_llm(model: Optional[str] = None) -> ChatGoogleGenerativeAI:
    """Initialize and return the Gemini LLM."""
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()

    if not api_key or api_key.startswith("your_"):
        raise ValueError(
            "Gemini API key was not found.\n\n"
            "Add your API key to the .env file:\n"
            "GEMINI_API_KEY=your_actual_api_key_here"
        )

    os.environ["GOOGLE_API_KEY"] = api_key
    model_name = model or DEFAULT_MODEL
    print(f"🤖 Initializing Gemini: {model_name}")

    return ChatGoogleGenerativeAI(
        model=model_name,
        google_api_key=api_key,
        temperature=0.0,
    )


# ── Generate Grounded Answer ────────────────────────────────────
def get_answer(llm: Any, context: str, question: str) -> str:
    """Send the structured prompt system matrix to Gemini and get a grounded answer."""
    # Build prompt payload using consolidated LexiPrompts class
    formatted_prompt = LexiPrompts.get_grounded_rag_prompt(question, context)

    messages = [
        ("user", formatted_prompt),
    ]

    return _execute_with_retry(llm, messages)


# ── Step 5 Query Rephraser Module ───────────────────────────────
def rephrase_question(llm: Any, chat_history: List[Dict[str, str]], question: str) -> str:
    """Transform multi-turn conversation into a optimized stateless semantic search query."""
    if not chat_history:
        return question

    formatted_prompt = LexiPrompts.get_reformulation_prompt(chat_history, question)
    
    messages = [
        ("user", formatted_prompt)
    ]
    
    rephrased = _execute_with_retry(llm, messages)
    return rephrased if rephrased else question


# ── Internal Resilient Request Handler ──────────────────────────
def _execute_with_retry(llm: Any, messages: list) -> str:
    """Internal robust wrapper handling rate-limiting retries and formatting fallbacks."""
    for attempt in range(MAX_RETRIES):
        try:
            print(f"📡 Sending request to Gemini (attempt {attempt + 1}/{MAX_RETRIES})...")
            response = llm.invoke(messages)
            content = getattr(response, "content", response)

            if content is None:
                return ""

            if isinstance(content, list):
                text_parts = []
                for block in content:
                    if isinstance(block, dict):
                        text_parts.append(str(block.get("text", "")))
                    else:
                        text_parts.append(str(getattr(block, "text", block)))
                return "".join(text_parts).strip()

            return str(content).strip()

        except Exception as e:
            error_text = str(e).lower()
            retryable_errors = (
                "429", "rate limit", "rate_limited", "resource exhausted",
                "too many requests", "503", "service unavailable"
            )

            is_retryable = any(error in error_text for error in retryable_errors)
            if not is_retryable or attempt == MAX_RETRIES - 1:
                print("❌ Gemini API request failed after retries.")
                raise

            wait_time = 2 ** (attempt + 1)
            print(f"⚠️ Temporary Gemini API error: {e}\n   Retrying in {wait_time} seconds...")
            time.sleep(wait_time)
            
    return ""
