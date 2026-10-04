import markdown

class LexiDossierExporter:
    @staticmethod
    def to_markdown(query: str, answer: str, citations: list) -> str:
        """Compiles clean plain-text dossiers."""
        doc_report = f"# LexiRAG Analysis Report\n\n## ❓ Query\n{query}\n\n## 💡 Generated Grounded Analysis\n{answer}\n\n## 📚 Source References Mapping\n"
        for i, cite in enumerate(citations):
            doc_report += f"- **[{i+1}] Document:** `{cite['source']}` | **Page:** `{cite['page']}`\n"
        return doc_report

    @staticmethod
    def to_html(markdown_text: str) -> str:
        """Converts Markdown strings to HTML code for native page prints or saves."""
        extensions = ['extra', 'smarty']
        html_content = markdown.markdown(markdown_text, extensions=extensions)
        return 
        f"""
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 30px; line-height: 1.6; color: #333; }}
                h1 {{ color: #1E3A8A; border-bottom: 2px solid #1E3A8A; }}
                h2 {{ color: #2563EB; margin-top: 20px; }}
                code {{ background: #F3F4F6; padding: 2px 4px; border-radius: 4px; }}
            </style>
        </head>
        <body>
            {html_content}
        </body>
        </html>
        """
