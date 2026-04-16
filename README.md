# Audiobook TTS

Converte Markdown em audiolivro com TTS em português brasileiro.

O projeto tem duas formas de uso:
- **CLI** para processar arquivos ou pastas `.md`
- **API/Web** para converter texto via navegador ou HTTP
- **Desktop Tauri** com interface visual para seleção de arquivos, pasta de saída e progresso

## Visão Geral

Modelos expostos na CLI:
- **Kokoro**: padrão, leve e offline
- **XTTS v2**: clonagem de voz a partir de `speaker_wav`
- **Edge-TTS**: online, gratuito, voz pt-BR da Microsoft
- **Edge-TTS + XTTS v2**: usa Edge como referência e XTTS para clonagem

## Instalação

### Básico
```bash
git clone <repo>
cd meu-projeto-tts
uv sync
```

### XTTS v2
```bash
uv sync --extra xtts
```

### Edge-TTS
```bash
uv sync --extra edge
```

### Edge-TTS + XTTS v2
```bash
uv sync --extra edge-xtts
```

### Todos os extras
```bash
uv sync --all-extras
```

## Comandos Importantes

### CLI principal
```bash
uv run main.py --help
uv run main.py livro.md
uv run main.py -i livro.md -m edge -o meu_audiobook.mp3
uv run main.py livro.md --max-workers 4
```

### Script instalado pelo projeto
```bash
tts-audiobook livro.md
```

### Servidor web
```bash
uv run server.py
```

O servidor sobe em `http://localhost:8000`.

### Desktop Tauri
```bash
bun run tauri:dev
```

O desktop usa o pipeline Python atual como bridge local e espera `python3`
disponível no sistema. A UI permite escolher arquivos ou pasta, definir a
pasta de saída, filtrar vozes e acompanhar o progresso por arquivo/chunk.

### Qualidade de código
```bash
uv run ruff check .
uv run ruff format .
```

Atalhos equivalentes via `make`:
```bash
make lint
make lint-fix
make format
```

### Verificação rápida de sintaxe
```bash
python3 -m py_compile main.py server.py
```

## Uso da CLI

### Exemplos básicos
```bash
uv run main.py livro.md
uv run main.py livro.md --model edge
uv run main.py livro.md --model xtts --speaker-wav minha_voz.wav
```

### Voz e velocidade
```bash
uv run main.py livro.md --voice pm_alex
uv run main.py livro.md --voice pm_santa
uv run main.py livro.md --speed 0.9
uv run main.py livro.md --speed 1.2
```

### Saída
```bash
uv run main.py livro.md -o meu_audiobook.mp3
uv run main.py livro.md --output-dir saida
```

### Retomar a partir de um chunk
```bash
uv run main.py livro.md --start-at 39
uv run main.py livro.md -s 39
```

`-s/--start-at` é `1-based`:
- em **arquivo único**, começa do chunk indicado
- em **pasta com `.md`**, pula os primeiros arquivos e começa no arquivo indicado

### Processar uma pasta
```bash
uv run main.py /meus/livros --model edge --output-dir /meus/livros/audio
```

Cada `.md` gera um `.mp3` com o mesmo nome base:
- `capitulo1.md` -> `audio/capitulo1.mp3`
- `capitulo2.md` -> `audio/capitulo2.mp3`

### Flags principais
- `-i/--input`: arquivo ou pasta de entrada
- `-m/--model`: `kokoro`, `xtts`, `edge` ou `edge-xtts`
- `-o/--output`: arquivo de saída em modo arquivo único
- `--output-dir`: diretório de saída em modo pasta
- `--voice`: voz do modelo
- `--speed`: velocidade de fala
- `--speaker-wav`: arquivo WAV de referência para XTTS v2
- `-s/--start-at`: chunk ou arquivo inicial
- `--max-workers`: número máximo de workers para paralelizar chunks
- `-q/--quiet`: reduz a saída no terminal

Se `--max-workers` não for informado, o projeto usa o padrão definido em `config.py` por modelo.

## Interface Web e API

### Subir a API
```bash
uv run server.py
```

### Endpoints
- `POST /api/convert`
- `GET /api/status/{job_id}`
- `GET /api/download/{job_id}`
- `GET /api/models`
- `DELETE /api/cleanup/{job_id}`

### Exemplo de conversão
```bash
curl -X POST http://localhost:8000/api/convert \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Seu texto aqui",
    "model": "kokoro",
    "voice": "pf_dora",
    "speed": 1.0
  }'
```

## Estrutura do Projeto

- `main.py`: entrada da CLI
- `server.py`: API FastAPI e interface web
- `md_to_text.py`: limpeza de Markdown
- `chunker.py`: divisão em chunks
- `generate_audio.py`: geração dos arquivos de áudio
- `merge_audio.py`: merge final em MP3
- `config.py`: configurações de modelos e vozes
- `templates/` e `static/`: interface web

## Troubleshooting

### `ModuleNotFoundError: No module named 'TTS'`
Instale os extras de XTTS:
```bash
uv sync --extra xtts
```

### `ModuleNotFoundError: No module named 'edge_tts'`
Instale o extra de Edge:
```bash
uv sync --extra edge
```

### XTTS pede `speaker_wav`
Use um WAV limpo de referência com voz única e sem ruído.

### Edge-TTS falha
O Edge-TTS depende de internet. Verifique conexão e DNS.

### Áudio ruim ou robótico
- tente ajustar `--speed`
- use um `speaker_wav` mais limpo no XTTS
- teste outro modelo para comparar

### `--start-at` fora do intervalo
O valor precisa ser `>= 1` e não pode ultrapassar a quantidade de chunks ou arquivos encontrados.

## Licenças

- Kokoro: MIT
- XTTS v2 / Coqui TTS: CPML
- pydub: MIT
