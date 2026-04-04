#!/usr/bin/env python3
"""
Servidor FastAPI para interface web de TTS
Recebe texto, converte para áudio com modelo selecionado, retorna download
"""

import os
import tempfile
from typing import Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uuid

from md_to_text import clean_markdown
from chunker import split_text
from generate_audio import generate
from merge_audio import merge
from config import EDGE_VOICES, PIPER_VOICES, resolve_voice

# ============================================================
# Configuração FastAPI
# ============================================================

app = FastAPI(title="TTS Audiobook Generator")

# CORS para requisições cross-origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Servir arquivos estáticos
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

# ============================================================
# Modelos de Request/Response
# ============================================================


class AudioRequest(BaseModel):
    text: str
    model: str = "kokoro"  # kokoro, edge, edge-xtts, xtts
    voice: Optional[str] = None
    speed: float = 1.0
    speaker_wav: Optional[str] = None


class AudioResponse(BaseModel):
    job_id: str
    status: str
    message: str


# ============================================================
# Sistema de Jobs para processamento async
# ============================================================

jobs = {}


class AudioJob:
    def __init__(self, job_id: str):
        self.job_id = job_id
        self.status = "pending"  # pending, processing, completed, error
        self.message = ""
        self.output_file = None
        self.error = None

    def to_dict(self):
        return {
            "job_id": self.job_id,
            "status": self.status,
            "message": self.message,
            "output_file": self.output_file,
            "error": self.error,
        }


# ============================================================
# Endpoints
# ============================================================


@app.get("/", response_class=HTMLResponse)
async def root():
    """Retorna a página HTML principal"""
    html_path = "templates/index.html"
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>TTS Audiobook Generator API</h1>"


@app.post("/api/convert")
async def convert_audio(request: AudioRequest, background_tasks: BackgroundTasks):
    """
    Endpoint para converter texto em áudio

    Request body:
    {
        "text": "Seu texto aqui",
        "model": "kokoro|edge|edge-xtts|xtts",
        "voice": "opcional, dependendo do modelo",
        "speed": 1.0,
        "speaker_wav": "opcional para XTTS"
    }

    Response:
    {
        "job_id": "uuid-do-job",
        "status": "processing",
        "message": "Iniciando processamento..."
    }
    """
    # Validações
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Texto não pode estar vazio")

    if request.model not in ["kokoro", "edge", "edge-xtts", "xtts"]:
        raise HTTPException(
            status_code=400, detail="Modelo deve ser: kokoro, edge, edge-xtts ou xtts"
        )

    if request.model == "xtts" and not request.speaker_wav:
        raise HTTPException(status_code=400, detail="XTTS requer speaker_wav")

    if not (0.5 <= request.speed <= 2.0):
        raise HTTPException(status_code=400, detail="Speed deve estar entre 0.5 e 2.0")

    # Criar job
    job_id = str(uuid.uuid4())
    job = AudioJob(job_id)
    jobs[job_id] = job

    # Iniciar processamento em background
    background_tasks.add_task(
        _process_audio,
        job_id=job_id,
        text=request.text,
        model=request.model,
        voice=request.voice,
        speed=request.speed,
        speaker_wav=request.speaker_wav,
    )

    return {
        "job_id": job_id,
        "status": "processing",
        "message": "Conversão iniciada...",
    }


@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    """Retorna o status de um job"""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job não encontrado")

    job = jobs[job_id]
    return job.to_dict()


@app.get("/api/download/{job_id}")
async def download_audio(job_id: str):
    """Download do arquivo de áudio gerado"""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job não encontrado")

    job = jobs[job_id]

    if job.status != "completed":
        raise HTTPException(
            status_code=400, detail=f"Áudio ainda não está pronto. Status: {job.status}"
        )

    if not job.output_file or not os.path.exists(job.output_file):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")

    return FileResponse(
        job.output_file, media_type="audio/mpeg", filename=f"audiobook_{job_id[:8]}.mp3"
    )


@app.get("/api/models")
async def get_models():
    """Retorna lista de modelos disponíveis"""
    return {
        "models": [
            {
                "id": "kokoro",
                "name": "Kokoro TTS",
                "description": "Rápido, offline, voz feminina pt-BR",
                "voices": {
                    "pf_dora": "Dora (Feminina)",
                    "pm_alex": "Alex (Masculino)",
                    "pm_santa": "Santa (Masculino)",
                },
                "supports_speaker_wav": False,
            },
            {
                "id": "edge",
                "name": "Edge-TTS",
                "description": "Online, gratuito, múltiplas vozes pt-BR",
                "voices": EDGE_VOICES,
                "supports_speaker_wav": False,
            },
            {
                "id": "piper",
                "name": "Piper TTS",
                "description": "Ultra-rápido em CPU, offline, qualidade natural",
                "voices": PIPER_VOICES,
                "supports_speaker_wav": False,
            },
            {
                "id": "edge-xtts",
                "name": "Edge-TTS + XTTS v2",
                "description": "Clonagem de voz Francisca com XTTS",
                "voices": {},
                "supports_speaker_wav": False,
            },
        ]
    }


@app.delete("/api/cleanup/{job_id}")
async def cleanup_job(job_id: str):
    """Limpa os dados do job"""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job não encontrado")

    job = jobs[job_id]
    if job.output_file and os.path.exists(job.output_file):
        try:
            os.remove(job.output_file)
        except OSError:
            pass

    del jobs[job_id]
    return {"message": "Job removido"}


# ============================================================
# Processamento em Background
# ============================================================


def _process_audio(
    job_id: str, text: str, model: str, voice: str, speed: float, speaker_wav: str
):
    """Processa conversão de áudio em background"""
    job = jobs[job_id]
    voice = resolve_voice(model, voice)

    try:
        job.status = "processing"
        job.message = "Limpando e dividindo texto..."

        # Criar diretório temporário para este job
        temp_dir = tempfile.mkdtemp(prefix=f"tts_job_{job_id[:8]}_")
        audio_dir = os.path.join(temp_dir, "audio")
        os.makedirs(audio_dir, exist_ok=True)

        # Processar texto
        clean_text = clean_markdown(text)
        chunks = split_text(clean_text)

        if not chunks:
            raise ValueError("Nenhum texto para processar após limpeza")

        job.message = f"Gerando áudio com {model.upper()}..."

        # Gerar áudio
        files = generate(
            chunks,
            output_dir=audio_dir,
            model=model,
            speaker_wav=speaker_wav,
            voice=voice,
            speed=speed,
        )

        if not files:
            raise ValueError("Falha ao gerar áudio")

        job.message = "Mesclando arquivos de áudio..."

        # Preparar metadata
        if model == "kokoro":
            model_name = "Kokoro-82M"
            voice_label = voice
        elif model == "xtts":
            model_name = "XTTS v2"
            voice_label = "clonagem"
        elif model == "edge":
            model_name = "Edge-TTS"
            voice_label = voice
        elif model == "piper":
            model_name = "Piper TTS"
            voice_label = voice
        elif model == "edge-xtts":
            model_name = "Edge-TTS + XTTS v2"
            voice_label = "Francisca clonada"

        # Salvar arquivo final
        output_file = os.path.join(temp_dir, "audiobook.mp3")
        merge(
            files,
            output=output_file,
            provider=model,
            model=model_name,
            voice=voice_label,
        )

        job.output_file = output_file
        job.status = "completed"
        job.message = f"Áudio gerado com sucesso! ({os.path.getsize(output_file) / 1024 / 1024:.1f} MB)"

    except Exception as e:
        job.status = "error"
        job.error = str(e)
        job.message = f"Erro ao gerar áudio: {e}"


# ============================================================
# Inicializar servidor
# ============================================================

if __name__ == "__main__":
    import uvicorn

    print("🚀 Iniciando servidor em http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
