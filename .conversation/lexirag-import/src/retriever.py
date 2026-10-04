# ─────────────────────────────────────────────────────────────────
# src/retriever.py
# WHAT THIS FILE DOES:
#   1. Takes a user question + ChromaDB vector store
#   2. Embeds the question (using the SAME model used for documents)
#   3. Finds the top-K most similar document chunks
#   4. Formats them into a context string the LLM can read
#
# WHY SEPARATE FROM rag.py:
#   You can test retrieval INDEPENDENTLY of the LLM.
#   If retrieval is bad, no LLM can save you.
# ─────────────────────────────────────────────────────────────────

from langchain_chroma import Chroma


def retrieve_chunks(vectorstore: Chroma, query: str, k: int = 4) -> list:
    """
    Embed the query and find the top-k most similar chunks.

    Args:
        vectorstore: A loaded LangChain Chroma vector store.
        query:       The user's question (English or Hindi).
        k:           Number of chunks to retrieve (default 4).

    Returns:
        List of LangChain Document objects, each with:
            .page_content  — the chunk text
            .metadata      — {source, page}
    """
    results = vectorstore.similarity_search(query, k=k)
    return results


def format_retrieved_chunks(chunks: list) -> str:
    """
    Format retrieved Document objects into a labelled context string.

    This is what gets injected into the LLM prompt so it knows
    which document and page each piece of information came from.

    Args:
        chunks: List of LangChain Document objects from retrieve_chunks().

    Returns:
        A formatted string like:
            --- Context 1 ---
            Source: report.pdf | Page: 12
            <chunk text>
    """
    if not chunks:
        return "No relevant context found."

    blocks = []
    for i, doc in enumerate(chunks, 1):
        source = doc.metadata.get("source", "Unknown")
        page = doc.metadata.get("page", "?")
        chunk_id = doc.metadata.get("chunk_id", f"c{i}")
        block = (
            f"--- Context {i} [Document: {source} | Page: {page} | Chunk ID: {chunk_id}] ---\n"
            f"{doc.page_content}\n"
        )
        blocks.append(block)

    return "\n".join(blocks)
