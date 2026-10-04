# app.py
import os
import streamlit as st

# ─── SAFE MODULE IMPORTS (Directly mapped to your src files) ───
from src.loader import load_documents
from src.embeddings import get_embedding_model
from src.rag import run_rag_pipeline, run_comparison_pipeline

# Safe fallbacks if these specialized files are still empty or in development
try:
    from src.extractors import LexiExtractors
except ImportError:
    LexiExtractors = None

try:
    from src.exporter import LexiDossierExporter
except ImportError:
    LexiDossierExporter = None

try:
    from src.llm import get_llm_instance  # Change this to whatever function sets up your Gemini model
except ImportError:
    # Basic fallback if your src.llm initialization varies
    from langchain_google_genai import ChatGoogleGenerativeAI
    def get_llm_instance():
        return ChatGoogleGenerativeAI(model="gemini-1.5-pro", temperature=0.0)

try:
    from src.vectorstore import get_vectorstore_instance  # Fallback helper to fetch or construct Chroma instance
except ImportError:
    from langchain_chroma import Chroma
    def get_vectorstore_instance(embedding_model):
        return Chroma(
            collection_name="lexirag_collection",
            embedding_function=embedding_model,
            persist_directory="vectorstore"
        )

# ─── CORE CONFIGURATIONS ───
RAW_DATA_DIR = "data/documents"
os.makedirs(RAW_DATA_DIR, exist_ok=True)

st.set_page_config(page_title="LexiRAG Pro Workspace", layout="wide", page_icon="⚖️")
st.title("⚖️ LexiRAG: Document Intelligence Suite")
st.caption("Powered by Google Gemini, LangChain, and BAAI/bge-m3 Multilingual Embeddings")
st.markdown("---")

# ─── PERSISTENT WORKSPACE STATES ───
if "messages" not in st.session_state:
    st.session_state["messages"] = []
if "indexed_files" not in st.session_state:
    st.session_state["indexed_files"] = []

# ─── CACHED ARCHITECTURE LOADER ───
@st.cache_resource(show_spinner=False)
def load_rag_backend():
    embeddings = get_embedding_model()  # Calls src/embeddings.py
    vectorstore = get_vectorstore_instance(embeddings)
    llm = get_llm_instance()
    return vectorstore, llm

vectorstore, llm = load_rag_backend()

# ─── CONTROL PANEL SIDEBAR ───
st.sidebar.header("📁 Document Ingestion Panel")
uploaded_files = st.sidebar.file_uploader(
    "Upload target corporate PDFs", 
    type=["pdf"], 
    accept_multiple_files=True
)

if st.sidebar.button("Process & Index Documents", type="primary"):
    if uploaded_files:
        with st.spinner("Parsing document structure layout and updating ChromaDB..."):
            # 1. Save files securely to disk
            for f in uploaded_files:
                path = os.path.join(RAW_DATA_DIR, f.name)
                with open(path, "wb") as buffer:
                    buffer.write(f.getbuffer())
            
            # 2. Extract texts using src/loader.py
            pages = load_documents(RAW_DATA_DIR)
            
            # 3. Commit raw extracted texts directly into your active Vectorstore instance
            if pages:
                texts = [p["text"] for p in pages]
                metadatas = [{"source": p["source"], "page": p["page"]} for p in pages]
                vectorstore.add_texts(texts=texts, metadatas=metadatas)
                
                # Update visual checklist tracking state
                for p in pages:
                    if p["source"] not in st.session_state["indexed_files"]:
                        st.session_state["indexed_files"].append(p["source"])
                        
            st.sidebar.success("Knowledge base refreshed and fully synchronized!")
    else:
        st.sidebar.warning("Please upload at least one PDF file first.")

# ─── RE-ARCHITECTED DASHBOARD TABS ───
tab1, tab2, tab3 = st.tabs(["💬 Conversational Chat Buffer", "📊 Comparative Engines", "🛠️ Analysis Tools"])

# TAB 1: CONVERSATIONAL SEARCH MATRIX WITH VERIFICATION PANES
with tab1:
    st.caption("Multi-turn context dialogue system using history-aware question reformulation.")
    
    # Render previous messages from state
    for msg in st.session_state["messages"]:
        with st.chat_message(msg["role"]):
            st.write(msg["content"])
            
    user_query = st.chat_input("Ask a question about your uploaded documents (supports English & Hindi)...")
    
    if user_query:
        # Commit user question to visual logs
        st.session_state["messages"].append({"role": "user", "content": user_query})
        with st.chat_message("user"):
            st.write(user_query)
            
        with st.spinner("Invoking Gemini cross-lingual semantic search..."):
            # Compute recent conversation limits for memory rephrasing
            history = st.session_state["messages"][:-1]
            
            # Fire Conductor execution pipeline inside src/rag.py
            res = run_rag_pipeline(
                vectorstore=vectorstore,
                llm=llm,
                question=user_query,
                chat_history=history
            )
            
            # Save generated result safely into conversation memory
            st.session_state["messages"].append({"role": "assistant", "content": res["answer"]})
            
            with st.chat_message("assistant"):
                st.write(res["answer"])
                
                # Side-by-Side Context Verification (Original Context Source Extract vs Output)
                if res.get("sources"):
                    st.markdown("### 🔍 Step 3 Verification: Source Text Chunks vs Target Answers")
                    col1, col2 = st.columns(2)
                    with col1:
                        st.markdown("**📄 Grounding Source Document Context Extracted**")
                        for idx, source_meta in enumerate(res["sources"]):
                            st.caption(f"Source: {source_meta['source']} | Page {source_meta['page']}")
                            if "text" in source_meta:
                                st.warning(source_meta["text"])
                    with col2:
                        st.markdown("**🌐 Grounded Analysis Focus Output**")
                        st.info(res["answer"])
                
                # Dossier Report Generation Engine Panel Integration
                if LexiDossierExporter and res.get("sources"):
                    st.markdown("### 💾 Step 7: Dossier Generation Exporter")
                    md_text = LexiDossierExporter.to_markdown(user_query, res["answer"], res["sources"])
                    st.download_button(
                        label="📥 Export Analysis Report (Markdown)",
                        data=md_text,
                        file_name="lexirag_analysis_dossier.md",
                        mime="text/markdown"
                    )

# TAB 2: CROSS-DOCUMENT DUAL FILTER ENGINE
with tab2:
    st.header("Filtered Multi-Document Comparison Matrix")
    files_list = st.session_state["indexed_files"]
    
    if len(files_list) >= 2:
        col_a, col_b = st.columns(2)
        with col_a:
            doc_a = st.selectbox("Select Target Document A", files_list, key="compare_doc_a")
        with col_b:
            doc_b = st.selectbox("Select Target Document B", files_list, key="compare_doc_b")
            
        compare_topic = st.text_input("Specify criteria for differential assessment (e.g., Liability Caps, Termination Clauses)")
        
        if st.button("Generate Comparison Table Matrix") and compare_topic:
            with st.spinner("Executing direct comparison across targeted collections..."):
                # Call comparative pipeline module inside src/rag.py
                comparison_matrix = run_comparison_pipeline(
                    vectorstore=vectorstore,
                    llm=llm,
                    doc_a=doc_a,
                    doc_b=doc_b,
                    topic=compare_topic
                )
                st.markdown("### 📊 Cross-Document Analysis Result Table")
                st.markdown(comparison_matrix)
    else:
        st.info("Please complete text ingestion for at least two target PDF files within the left dashboard pane to access comparisons.")

# TAB 3: EXTRACTORS SERVICE GATEWAY
with tab3:
    st.header("Specialized Knowledge Extraction Modules")
    if LexiExtractors and files_list:
        selected_target_doc = st.selectbox("Target Document Context Selector", files_list, key="extract_target")
        tool_mode = st.radio("Select Target Extract Utility Profile", ["Clause Risk Extractor", "Deadlines Timeline Builder"])
        
        if st.button("Run Specialized Extraction Engine"):
            with st.spinner("Extracting properties using structured prompts via Gemini..."):
                raw_data = vectorstore.get(where={"source": selected_target_doc})
                document_full_text = " ".join(raw_data.get("documents", []))
                
                if document_full_text.strip():
                    instanced_extractor = LexiExtractors(llm=llm)
                    if tool_mode == "Clause Risk Extractor":
                        extracted_output = instanced_extractor.extract_clauses(document_full_text[:8000])
                    else:
                        extracted_output = instanced_extractor.build_chronological_timeline(document_full_text[:8000])
                        
                    st.markdown("### 🛠️ Extraction Output Metrics Summary")
                    st.markdown(extracted_output)
                else:
                    st.error("Target selected source document text space appears empty or unparsed.")
    else:
        st.info("Extraction tools will unlock once specialized extractor scripts are mounted and documents are indexed.")
