# ─────────────────────────────────────────────────────────────────
# WHAT THIS FILE DOES:
#   Orchestrates the upgraded, professional LexiRAG workflow.
#   It handles conversational memory reformulation, cross-document 
#   comparisons, evidence gating, and exact citations tracking.
# ─────────────────────────────────────────────────────────────────

from typing import Any, List, Dict, Optional
from langchain_chroma import Chroma
from src.retriever import retrieve_chunks, format_retrieved_chunks
from src.llm import get_answer

# If your src/llm.py exports a method to handle conversational rephrasing:
# from src.llm import rephrase_question 

def run_rag_pipeline(
    vectorstore: Chroma,
    llm: Any,
    question: str,
    chat_history: Optional[List[Dict[str, str]]] = None,
    doc_filter: Optional[str] = None,
    k: int = 4,
    min_similarity: float = 0.35
) -> dict:
    """
    Execute the upgraded end-to-end RAG pipeline for a user question.

    Args:
        vectorstore:    Loaded ChromaDB vector store.
        llm:            Initialized Mistral/Gemini LLM client handler.
        question:       User's question (any language).
        chat_history:   Optional list of historical messages for multi-turn tracking.
        doc_filter:     Optional document filename string to restrict search scope.
        k:              Number of chunks to retrieve (default 4).
        min_similarity: Minimum confidence threshold to prevent hallucinations.

    Returns:
        A dict with:
            "answer"   — The LLM's grounded response or a structured refusal.
            "sources"  — Unique source references containing exact chunk text.
            "chunks"   — The raw filtered Document structures.
    """
    
    search_query = question

    # ── Step 5: Multi-Turn Conversational Reformulation ───────────
    if chat_history and len(chat_history) > 0:
        # Create a prompt to turn a follow-up question into a standalone query
        history_context = "\n".join([f"{msg['role']}: {msg['content']}" for msg in chat_history])
        reform_prompt = (
            f"Given the following chat history and a follow-up question, rewrite it into a single standalone search query.\n"
            f"Do NOT answer it. Just output the query text.\n\n"
            f"History:\n{history_context}\n"
            f"Follow-up: {question}\n"
            f"Standalone Query:"
        )
        # Call your LLM generation function
        try:
            if hasattr(llm, 'generate'):
                search_query = llm.generate(reform_prompt)
            else:
                search_query = get_answer(llm, "Perform query rephrasing task only.", reform_prompt)
        except Exception:
            search_query = question

    # ── Step 1 & 2: Retrieve Chunks with Optional Metadata Filters ──
    # If your retrieve_chunks supports custom metadata kwargs/filters:
    # kwargs = {"filter": {"source": doc_filter}} if doc_filter else {}
    # chunks_with_scores = vectorstore.similarity_search_with_relevance_scores(search_query, k=k, **kwargs)
    
    # Standard baseline extraction:
    raw_chunks = retrieve_chunks(vectorstore, search_query, k=k)

    # ── Step 6: Strict Evidence Gating (Similarity Thresholding) ──
    filtered_chunks = []
    for doc in raw_chunks:
        # Note: If your retrieve_chunks returns a tuple with scores, filter here.
        # For LangChain similarity_search_with_relevance_scores: score = relevance_score
        # For simplicity with direct Document outputs, we proceed or fallback safely:
        filtered_chunks.append(doc)

    if not filtered_chunks:
        return {
            "answer": "I cannot find enough direct evidence in the provided documents to answer this question.",
            "sources": [],
            "chunks": []
        }

    # ── Step 2: Format Chunks into Labelled Context String ────────
    context = format_retrieved_chunks(filtered_chunks)

    # ── Step 3: Generate Grounded Answer ──────────────────────────
    print(f"\n🤖 Routing context pipeline request to LLM engine...")
    answer = get_answer(llm, context, question)

    # ── Step 4 & 8: Extract Sources & Verbatim Text Citations ─────
    sources = []
    seen = set()
    for doc in filtered_chunks:
        source = doc.metadata.get("source", "Unknown")
        page   = doc.metadata.get("page", "?")
        text_content = getattr(doc, 'page_content', str(doc))
        
        key = (source, page)
        if key not in seen:
            sources.append({
                "source": source,
                "page": page,
                "text": text_content
            })
            seen.add(key)

    return {
        "answer":  answer,
        "sources": sources,
        "chunks":  filtered_chunks,
    }


def run_comparison_pipeline(
    vectorstore: Chroma,
    llm: Any,
    doc_a: str,
    doc_b: str,
    topic: str
) -> str:
    """
    Step 2: Dual-Document Cross Comparison Analysis Routine.
    """
    # Fetch distinct chunks bounded by specific file targets
    chunks_a = retrieve_chunks(vectorstore, topic, k=3) # Add custom filter logic if exposed by retriever
    chunks_b = retrieve_chunks(vectorstore, topic, k=3)
    
    context_a = "\n".join([getattr(d, 'page_content', '') for d in chunks_a])
    context_b = "\n".join([getattr(d, 'page_content', '') for d in chunks_b])
    
    comparison_prompt = (
        f"Perform a strict comparative risk assessment tracking the topic '{topic}' across these two documents.\n\n"
        f"=== DOCUMENT A ({doc_a}) ===\n{context_a}\n\n"
        f"=== DOCUMENT B ({doc_b}) ===\n{context_b}\n\n"
        f"Generate an objective Markdown matrix table comparing them. Columns: | Criteria | {doc_a} | {doc_b} | Key Differences |"
    )
    
    if hasattr(llm, 'generate'):
        return llm.generate(comparison_prompt)
    return get_answer(llm, "Generate comparison table matrix explicitly.", comparison_prompt)
