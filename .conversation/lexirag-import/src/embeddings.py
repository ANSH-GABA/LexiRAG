# ─────────────────────────────────────────────────────────────────
# src/embeddings.py
# WHAT THIS FILE DOES:
#   Provides a single function that loads a multilingual embedding
#   model compatible with LangChain's Chroma integration.
#
# MODEL CHOICE: BAAI/bge-m3
#   - Supports 100+ languages (critical for Hindi + English RAG)
#   - Works with sentence-transformers library
#   - Returns 1024-dimensional vectors
#
# WHY A FUNCTION, NOT A CLASS:
#   LangChain's Chroma.from_documents() needs an Embeddings object.
#   HuggingFaceEmbeddings already IS that object. We just configure
#   and return it — no wrapper class needed.
# ─────────────────────────────────────────────────────────────────

from langchain_huggingface import HuggingFaceEmbeddings


def get_embedding_model(
    model_name: str = "BAAI/bge-m3",
) -> HuggingFaceEmbeddings:
    """
    Load a multilingual sentence-transformer embedding model.

    The model is loaded once and cached by the caller (e.g. Streamlit's
    @st.cache_resource or the vectorstore module).

    Args:
        model_name: HuggingFace model ID. Default is BAAI/bge-m3
                    which handles English, Hindi, and 100+ languages.

    Returns:
        A LangChain Embeddings object that can be passed directly
        to Chroma.from_documents() or vectorstore.similarity_search().
    """
    print(f"--> Loading embedding model: {model_name}")
    print("----> (First run downloads ~2 GB — subsequent runs use cache)")

    return HuggingFaceEmbeddings(
        model_name=model_name,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )
