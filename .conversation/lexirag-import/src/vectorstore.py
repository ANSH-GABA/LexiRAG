# ─────────────────────────────────────────────────────────────────
# src/vectorstore.py
# WHAT THIS FILE DOES:
#   1. Takes raw page dictionaries from loader.py
#   2. Splits them into smaller text chunks
#   3. Stores chunks + their embeddings in ChromaDB
#   4. Can also load an already-existing ChromaDB from disk
#
# WHY CHUNK?
#   A full PDF page might be 3000 characters. If we embed the
#   entire page, the embedding captures a blurry average of all
#   topics on that page. If we split into 800-char chunks, each
#   chunk is more focused → more accurate similarity search.
#
# WHY PERSIST?
#   Building embeddings for 100 pages × 768 numbers = slow.
#   We save ChromaDB to disk so the next app start skips this.
# ─────────────────────────────────────────────────────────────────

import os
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_core.documents import Document
from src.embeddings import get_embedding_model


# ── Constants ─────────────────────────────────────────────────────
VECTORSTORE_DIR = "vectorstore"    # Folder on disk where ChromaDB lives
COLLECTION_NAME = "lexirag_docs"   # Name for our ChromaDB collection


def build_vectorstore(pages: list[dict]) -> Chroma:
    """
    Chunk the pages, embed them, and save to ChromaDB.

    This function is called ONCE — when the user uploads new PDFs.
    After that, load_vectorstore() is used instead.

    Args:
        pages: List of dicts from loader.py, each with text/page/source.

    Returns:
        A Chroma vector store object ready for querying.
    """

    # ── Step 1: Convert raw dicts → LangChain Document objects ────
    # LangChain uses a standard Document class that bundles text
    # with metadata. We convert our dicts to this format.
    raw_docs = []
    for page in pages:
        raw_docs.append(
            Document(
                page_content=page["text"],
                metadata={
                    "source": page["source"],
                    "page":   page["page"],
                }
            )
        )
    print(f"--> Total pages as Documents: {len(raw_docs)}")

    # ── Step 2: Split pages into chunks ───────────────────────────
    # RecursiveCharacterTextSplitter tries to split on:
    #   "\n\n" (paragraph) → "\n" (line) → " " (word) → char-by-char
    # This preserves semantic units better than blind character slicing.
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,       # Target chunk length (characters)
        chunk_overlap=100,    # Overlap keeps context at boundaries
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_documents(raw_docs)

    # Assign deterministic chunk_id (e.g. DocName_p1_c1) for precise passage anchoring
    chunk_counters = {}
    for chunk in chunks:
        raw_source = chunk.metadata.get("source", "doc")
        source_name = os.path.splitext(os.path.basename(raw_source))[0]
        page_num = chunk.metadata.get("page", 1)
        key = (source_name, page_num)
        chunk_counters[key] = chunk_counters.get(key, 0) + 1
        chunk_idx = chunk_counters[key]
        chunk.metadata["chunk_id"] = f"{source_name}_p{page_num}_c{chunk_idx}"

    print(f"--> Total chunks after splitting: {len(chunks)}")

    # ── Step 3: Load the embedding model ──────────────────────────
    embedding_model = get_embedding_model()

    # ── Step 4: Create ChromaDB and embed all chunks ──────────────
    # Chroma.from_documents() does three things at once:
    #   a) Embeds each chunk using embedding_model
    #   b) Stores the vectors in ChromaDB
    #   c) Saves everything to persist_directory on disk
    print("⚙️  Embedding chunks and saving to ChromaDB...")
    print("   (This takes 1–5 minutes depending on your hardware)")

    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embedding_model,
        persist_directory=VECTORSTORE_DIR,
        collection_name=COLLECTION_NAME,
    )

    print(f"\n ✅ ChromaDB built and saved to '{VECTORSTORE_DIR}/'")
    print(f"   Total vectors stored: {vectorstore._collection.count()}")
    return vectorstore


def load_vectorstore() -> Chroma:
    """
    Load an already-built ChromaDB from disk.

    Returns:
        A Chroma vector store object ready for querying.
    """
    print(f"\n 📂 Loading existing ChromaDB from '{VECTORSTORE_DIR}/'...")
    embedding_model = get_embedding_model()

    vectorstore = Chroma(
        persist_directory=VECTORSTORE_DIR,
        embedding_function=embedding_model,
        collection_name=COLLECTION_NAME,
    )
    print(f"\n ✅ ChromaDB loaded. Vectors: {vectorstore._collection.count()}")
    return vectorstore


def vectorstore_exists() -> bool:
    """
    Check whether a persisted ChromaDB already exists on disk.

    Returns:
        True if the database directory exists and is non-empty.
    """
    return (
        os.path.exists(VECTORSTORE_DIR) and
        len(os.listdir(VECTORSTORE_DIR)) > 0
    )
