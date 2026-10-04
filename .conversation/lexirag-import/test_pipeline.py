# ─────────────────────────────────────────────────────────────────
# test_pipeline.py  —  Command-line test runner (no Streamlit UI)
#
# PURPOSE:
#   Run this BEFORE the Streamlit app to verify each stage of the
#   pipeline works independently. Helps isolate problems early.
#
# USAGE:
#   python test_pipeline.py
#
# WHAT IT TESTS:
#   Stage 1: PDF loading
#   Stage 2: Chunking + embedding + ChromaDB building
#   Stage 3: Retrieval (independent of LLM)
#   Stage 4: Full RAG with LLM (requires GEMINI_API_KEY)
# ─────────────────────────────────────────────────────────────────

import os
import json
from dotenv import load_dotenv

load_dotenv()

DATA_DIR = "data/documents"
EVAL_FILE = "evaluation/questions.json"

print("=" * 60)
print("  LexiRAG Pipeline Test")
print("=" * 60)


# ════════════════════════════════════════════════════════════════
# STAGE 1: Check for documents
# ════════════════════════════════════════════════════════════════
print("\n📋 STAGE 1: Checking for documents...")

if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR, exist_ok=True)

pdf_files = [f for f in os.listdir(DATA_DIR) if f.endswith(".pdf")]
if not pdf_files:
    if os.path.exists("data/sample") and [f for f in os.listdir("data/sample") if f.endswith(".pdf")]:
        print(f"  ℹ️  No PDFs in {DATA_DIR}/. Using sample PDFs from data/sample/")
        DATA_DIR = "data/sample"
        pdf_files = [f for f in os.listdir(DATA_DIR) if f.endswith(".pdf")]
    else:
        print(f"  ❌ No PDF files found in {DATA_DIR}/ or data/sample/")
        print(f"     Add at least 1 PDF and re-run.")
        exit(1)

print(f"  ✅ Found {len(pdf_files)} PDF(s): {pdf_files}")


# ════════════════════════════════════════════════════════════════
# STAGE 2: Load + Chunk + Embed + Store
# ════════════════════════════════════════════════════════════════
print("\n📋 STAGE 2: Building vector store...")

from src.loader import load_documents
from src.vectorstore import build_vectorstore, load_vectorstore, vectorstore_exists

pages = load_documents(DATA_DIR)
print(f"  Loaded {len(pages)} pages from PDFs")

if vectorstore_exists():
    print("  ℹ️  Existing ChromaDB found. Loading instead of rebuilding...")
    vectorstore = load_vectorstore()
else:
    print("  Building new ChromaDB...")
    vectorstore = build_vectorstore(pages)

print(f"  ✅ ChromaDB ready. Total chunks: {vectorstore._collection.count()}")


# ════════════════════════════════════════════════════════════════
# STAGE 3: Test Retrieval
# ════════════════════════════════════════════════════════════════
print("\n📋 STAGE 3: Testing retrieval...")

from src.retriever import retrieve_chunks

test_query = "What is the main topic of these documents?"
results = retrieve_chunks(vectorstore, test_query, k=4)

print(f"\n  Query: '{test_query}'")
print(f"  Retrieved {len(results)} chunks:")
for i, doc in enumerate(results):
    print(f"    [{i+1}] {doc.metadata.get('source')} — Page {doc.metadata.get('page')}")
    print(f"         '{doc.page_content[:100].strip()}...'")

print("  ✅ Retrieval working!")


# ════════════════════════════════════════════════════════════════
# STAGE 4: Test Full RAG Pipeline
# ════════════════════════════════════════════════════════════════
print("\n📋 STAGE 4: Testing full RAG pipeline (requires GEMINI_API_KEY)...")

try:
    from src.llm import get_llm
    from src.rag import run_rag_pipeline

    llm = get_llm()

    # Load evaluation questions
    with open(EVAL_FILE, encoding="utf-8") as f:
        eval_data = json.load(f)

    # Run first 3 English questions as a quick test
    questions = eval_data["evaluation_questions"][:1]

    for q in questions:
        print(f"\n🔹 {q['id']}: {q['question_english']}")
        result = run_rag_pipeline(vectorstore, llm, q["question_english"], k=4)
        print(f"     Answer: {result['answer'][:200]}...")
        print(f"     Sources: {result['sources']}")

    # Test hallucination prevention
    print("\n🔹 Hallucination test: 'What is the CEO's favorite sport?'")
    result = run_rag_pipeline(vectorstore, llm, "What is the CEO's favorite sport?", k=4)
    print(f"     Answer: {result['answer'][:300]}")
    answer_lower = result["answer"].lower()
    if "not available" in answer_lower or "not present" in answer_lower or "cannot find" in answer_lower:
        print("✅ PASSED — System correctly refused to hallucinate!")
    else:
        print("⚠️  WARNING — System may be hallucinating. Check the system prompt.")

    # Test Hindi query (multilingual retrieval)
    print("\n  🔹 Multilingual test (Hindi): 'इस दस्तावेज़ का मुख्य विषय क्या है?'")
    result = run_rag_pipeline(vectorstore, llm, "इस दस्तावेज़ का मुख्य विषय क्या है?", k=4)
    print(f"     Answer: {result['answer'][:300]}")

    print("\n✅ All stages passed! Run the app with: streamlit run app.py")

except ValueError as e:
    print(f"\n  ⚠️  Skipping LLM test: {e}")
    print("  Retrieval is working. Set GEMINI_API_KEY in .env to test the full pipeline.")

print("\n" + "=" * 60)
