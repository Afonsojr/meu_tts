import re


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_PARAGRAPH_RE = re.compile(r"\n\s*\n+")


def split_text(text, max_chars=400):
    paragraphs = [p.strip() for p in _PARAGRAPH_RE.split(text) if p.strip()]
    chunks = []

    for paragraph_index, paragraph in enumerate(paragraphs, start=1):
        paragraph_chunks = _split_paragraph(paragraph, max_chars)
        last_index = len(paragraph_chunks) - 1

        for chunk_index, chunk_text in enumerate(paragraph_chunks):
            chunk_text = chunk_text.strip()
            if not chunk_text:
                continue

            chunks.append(
                {
                    "text": chunk_text,
                    "paragraph_index": paragraph_index,
                    "paragraph_end": chunk_index == last_index,
                }
            )

    return chunks


def _split_paragraph(paragraph, max_chars):
    sentences = [s.strip() for s in _SENTENCE_RE.split(paragraph) if s.strip()]
    chunks = []
    current = ""

    for sentence in sentences:
        if len(sentence) > max_chars:
            if current:
                chunks.append(current)
                current = ""

            chunks.extend(_split_by_words(sentence, max_chars))
            continue

        if current and len(current) + 1 + len(sentence) <= max_chars:
            current = f"{current} {sentence}"
        else:
            if current:
                chunks.append(current)
            current = sentence

    if current:
        chunks.append(current)

    return chunks


def _split_by_words(text, max_chars):
    words = text.split()
    if not words:
        return []

    chunks = []
    current = ""

    for word in words:
        if not current:
            if len(word) <= max_chars:
                current = word
            else:
                chunks.extend(_split_oversized_token(word, max_chars))
                current = ""
            continue

        if len(current) + 1 + len(word) <= max_chars:
            current = f"{current} {word}"
            continue

        chunks.append(current)
        if len(word) <= max_chars:
            current = word
        else:
            chunks.extend(_split_oversized_token(word, max_chars))
            current = ""

    if current:
        chunks.append(current)

    return chunks


def _split_oversized_token(token, max_chars):
    if max_chars < 1:
        return [token]

    chunks = []
    start = 0

    while start < len(token):
        end = min(start + max_chars, len(token))
        chunks.append(token[start:end])
        start = end

    return chunks
