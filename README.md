# Audiobook TTS - Kokoro + XTTS v2

Converte arquivos Markdown para Audiobook usando TTS (Text-to-Speech) em português brasileiro.

## Features

✅ **Kokoro TTS** (padrão)
- Leve (82M parâmetros)
- Voz feminina brasileira nativa (`pf_dora`)
- Funciona bem em CPU
- Projeto mantido e ativo

✅ **XTTS v2** (clonagem de voz)
- Clona voz de arquivo de referência
- Alta qualidade
- Suporta qualquer voz feminina brasileira
- Requer GPU para performance ótima

## Instalação

### Mínimo (Kokoro)
```bash
git clone <repo>
cd meu-projeto-tts
uv sync
```

### Completo (Kokoro + XTTS v2)
```bash
uv sync --all-extras
# ou
uv sync --extra xtts
```

## Qualidade de código

### Ruff
```bash
uv run ruff check .
uv run ruff format .
```

Se preferir atalhos via `make`:
```bash
make lint
make lint-fix
make format
```

## Uso

### Básico (Kokoro com voz feminina padrão)
```bash
uv run main.py livro.md
```

### Customize velocidade (Kokoro)
```bash
uv run main.py livro.md --speed 0.9  # Mais lento
uv run main.py livro.md --speed 1.2  # Mais rápido
```

### Vozes alternativas (Kokoro)
```bash
# Voz masculina (Alex)
uv run main.py livro.md --voice pm_alex

# Voz masculina (Santa)
uv run main.py livro.md --voice pm_santa
```

### XTTS v2 com clonagem de voz
```bash
uv run main.py livro.md \
  --model xtts \
  --speaker-wav caminho/para/sua_voz.wav
```

**Requisitos do arquivo WAV:**
- Duração: 10-30 segundos
- Formato: WAV mono
- Taxa de amostragem: qualquer
- Qualidade: voz limpa, sem ruído de fundo

### Customize saída
```bash
uv run main.py livro.md -o meu_audiobook.mp3
uv run main.py livro.md --audio-dir saida/chunks
```

### Atalhos da CLI
```bash
uv run main.py -i livro.md -m edge -o meu_audiobook.mp3 -s 35
```

Atalhos disponíveis:
- `-i` = entrada
- `-m` = modelo
- `-o` = saída
- `-s` = start-at

### Pasta com vários arquivos `.md`
```bash
uv run main.py /meus/livros --model edge --output-dir /meus/livros/audio
```

Isso gera um MP3 para cada `.md` encontrado na pasta de entrada, usando o mesmo nome base:
- `capitulo1.md` -> `audio/capitulo1.mp3`
- `capitulo2.md` -> `audio/capitulo2.mp3`

Se uma execução travar no meio da pasta, você pode retomar a partir de um arquivo específico com `--start-at`:
```bash
uv run main.py /meus/livros --model edge --output-dir /meus/livros/audio --start-at 35
```
Isso pula os 34 primeiros `.md` e começa no 35º arquivo da lista ordenada.

Para um arquivo Markdown único, `--start-at` pula chunks internos. Exemplo:
```bash
uv run main.py livro.md --start-at 35
```
Isso começa do chunk 35.

### Ver todas as opções
```bash
uv run main.py --help
```

## Exemplo Completo

```bash
# Gerar com Kokoro, voz feminina, velocidade 0.95x
uv run main.py capitulo1.md -o capitulo1.mp3 --speed 0.95

# Ou com XTTS v2, sua própria voz
uv run main.py capitulo1.md \
  --model xtts \
  --speaker-wav minha_voz.wav \
  -o capitulo1_minha_voz.mp3
```

## Comparação Kokoro vs XTTS v2

| Aspecto | Kokoro | XTTS v2 |
|---------|--------|---------|
| Naturalidade | 8/10 | 9/10 |
| Configuração | Fácil | Requer arquivo WAV |
| Velocidade | Rápida (CPU ok) | Lenta (GPU melhor) |
| Peso | Leve (82M) | Pesado (327M) |
| Vozes pt-BR | 1 feminina | Infinitas (clonagem) |
| Manutenção | Ativo | Encerrado |

## Troubleshooting

### "ModuleNotFoundError: No module named 'TTS'"
Você está tentando usar XTTS mas não instalou. Execute:
```bash
uv sync --extra xtts
```

### XTTS muito lento
Confira se tem GPU disponível. Configure em `config.py`:
```python
XTTS_CONFIG['device'] = 'cuda'  # ou 'cpu'
```

### Áudio com qualidade ruim
- Para Kokoro: tente ajustar `--speed`
- Para XTTS: use arquivo WAV de melhor qualidade

## Licenses

- **Kokoro**: MIT (hexgrad/Kokoro-82M)
- **XTTS v2**: CPML (Coqui TTS)
- **pydub**: MIT
