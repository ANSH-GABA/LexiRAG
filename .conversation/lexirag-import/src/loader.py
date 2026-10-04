# ─────────────────────────────────────────────────────────────────
# src/loader.py
# WHAT THIS FILE DOES:
#   Reads every PDF in a directory and extracts text page-by-page.
#   Returns a flat list of dicts: [{text, source, page}, ...]
#
# WHY:
#   This is the first stage of the RAG pipeline. We need raw text
#   with metadata (filename + page number) so that the final answer
#   can cite exactly where the information came from.
# ─────────────────────────────────────────────────────────────────

import os
import pymupdf


def load_documents(directory: str) -> list[dict]:
    """
    Load all PDFs from a directory, extract text page by page.

    Args:
        directory: Path to a folder containing .pdf files.

    Returns:
        List of dicts, each with keys: text, source, page.
        Example: {"text": "...", "source": "report.pdf", "page": 3}
    """
    if not os.path.exists(directory):
        raise FileNotFoundError(f"Directory not found: {directory}")

    pdf_files = sorted(
        f for f in os.listdir(directory) if f.lower().endswith(".pdf")
    )

    if not pdf_files:
        print(f"⚠️  No PDF files found in {directory}/")
        return []

    pages = []

    for filename in pdf_files:
        filepath = os.path.join(directory, filename)
        print(f"📄 Loading: {filename}")

        with pymupdf.open(filepath) as doc:
            for page_idx in range(doc.page_count):
                page = doc.load_page(page_idx)
                text = page.get_text("text").strip()

                # Skip empty pages (e.g. blank dividers)
                if not text:
                    continue

                pages.append({
                    "text": text,
                    "source": filename,
                    "page": page_idx + 1,
                })

    print(f"✅ Loaded {len(pages)} pages from {len(pdf_files)} PDF(s)")
    return pages
