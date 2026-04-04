import re


def split_text(text, max_chars=400):
    # Dividir por pontuação final real (. ! ?) seguida de espaço
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks = []
    current = ""

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        # Se o chunk atual + sentença cabe no limite
        if len(current) + len(sentence) + 1 <= max_chars:
            current = (current + " " + sentence).strip()
        else:
            # Guardar chunk atual se tiver conteúdo
            if current:
                chunks.append(current)

            # Se a sentença por si só for maior que max_chars, truncar
            while len(sentence) > max_chars:
                chunks.append(sentence[:max_chars])
                sentence = sentence[max_chars:].strip()

            current = sentence

    # Guardar último chunk se tiver conteúdo
    if current.strip():
        chunks.append(current.strip())

    # Filtrar chunks vazios
    return [c for c in chunks if c.strip()]
