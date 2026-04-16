import re


def clean_markdown(md_text: str) -> str:
    md_text = re.sub(r"\r\n?", "\n", md_text)

    # remove blocos de código
    md_text = re.sub(r"```.*?```", "", md_text, flags=re.DOTALL)

    # remove inline code (backticks simples)
    md_text = re.sub(r"`([^`]+)`", r"\1", md_text)

    # remove markdown básico
    md_text = re.sub(r"^#+\s+.*$", "", md_text, flags=re.MULTILINE)  # títulos
    md_text = re.sub(r"\*\*(.*?)\*\*", r"\1", md_text)  # negrito
    md_text = re.sub(r"__(.*?)__", r"\1", md_text)  # negrito alternativo
    md_text = re.sub(r"\*(.*?)\*", r"\1", md_text)  # itálico
    md_text = re.sub(r"_(.*?)_", r"\1", md_text)  # itálico alternativo
    md_text = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", md_text)  # links

    # remove listas markdown
    md_text = re.sub(
        r"^\s*[-*+]\s+", "", md_text, flags=re.MULTILINE
    )  # listas com - * +
    md_text = re.sub(
        r"^\s*\d+\.\s+", "", md_text, flags=re.MULTILINE
    )  # listas numeradas

    # remove blockquotes
    md_text = re.sub(r"^>\s+", "", md_text, flags=re.MULTILINE)

    # normaliza espaçamento preservando parágrafos
    md_text = md_text.replace("—", "-")  # travessão → hífen
    md_text = re.sub(r"\n{3,}", "\n\n", md_text)

    paragraphs = []
    for block in re.split(r"\n\s*\n+", md_text):
        block = re.sub(r"\s*\n\s*", " ", block)
        block = re.sub(r"\s+", " ", block).strip()
        if block:
            paragraphs.append(block)

    return "\n\n".join(paragraphs).strip()
