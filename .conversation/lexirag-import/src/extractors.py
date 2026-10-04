from src.llm import LexiLLM

class LexiExtractors:
    def __init__(self, llm: LexiLLM):
        self.llm = llm

    def extract_clauses(self, raw_context: str) -> str:
        prompt = (
            "Analyze the text context below and extract standard contract clauses "
            "(Termination, Liability, Governing Law, Indemnification).\n"
            "Output a Markdown summary listing: Clause Type, Verbatim Clause Text, and a simple Risk Rating (Low/Med/High).\n\n"
            f"Context:\n{raw_context}"
        )
        return self.llm.generate(prompt)

    def build_chronological_timeline(self, raw_context: str) -> str:
        prompt = (
            "Scan the context text below for all dates, milestones, operational deadlines, and renewal timelines.\n"
            "Organize them into a chronological Markdown table with columns: | Date / Window | Milestone Event Description | Risk/Deadline Classification |\n\n"
            f"Context:\n{raw_context}"
        )
        return self.llm.generate(prompt)
