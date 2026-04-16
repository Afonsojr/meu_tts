"""
Gerador de áudio suportando Kokoro TTS, XTTS v2, Edge-TTS e Edge-TTS + XTTS v2

Modelos disponíveis:
  - kokoro: Kokoro TTS com voz pré-treinada pt-BR
  - xtts: XTTS v2 com clonagem (precisa speaker_wav)
  - edge: Edge-TTS com voz Francisca pt-BR (online, grátis)
  - edge-xtts: Edge-TTS + XTTS v2 (gera referência do Edge, clona com XTTS)
  - piper: Piper TTS com voz local em CPU
"""

import asyncio
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import soundfile as sf
from config import (
    KOKORO_CONFIG,
    XTTS_CONFIG,
    EDGE_CONFIG,
    EDGE_XTTS_CONFIG,
    PIPER_CONFIG,
    DEFAULT_GENERATION_WORKERS,
    GENERATION_WORKERS,
    resolve_voice,
)

# Lazy loading de modelos por thread
_thread_state = threading.local()
_print_lock = threading.Lock()


def _chunk_text(chunk):
    if isinstance(chunk, dict):
        return str(chunk.get("text", ""))
    return str(chunk)


def _chunk_paragraph_end(chunk):
    if isinstance(chunk, dict):
        return bool(chunk.get("paragraph_end"))
    return False


def _log(message):
    with _print_lock:
        print(message, flush=True)


def _build_chunk_jobs(chunks, output_dir, start_at=1):
    jobs = []

    for i, chunk in enumerate(chunks, start=1):
        if i < start_at:
            continue

        chunk_text = _chunk_text(chunk)
        if not chunk_text.strip():
            continue

        jobs.append(
            {
                "index": i,
                "text": chunk_text,
                "paragraph_end": _chunk_paragraph_end(chunk),
                "path": f"{output_dir}/part_{i - 1}.wav",
                "temp_mp3": f"{output_dir}/.part_{i - 1}_edge.mp3",
            }
        )

    return jobs


def _resolve_worker_count(model, max_workers=None):
    if max_workers is not None:
        if max_workers < 1:
            raise ValueError("max_workers deve ser maior ou igual a 1")
        return max_workers

    default_workers = GENERATION_WORKERS.get(model, DEFAULT_GENERATION_WORKERS)
    cpu_count = os.cpu_count() or default_workers
    return max(1, min(default_workers, cpu_count))


def _run_chunk_jobs(jobs, worker, max_workers, progress_callback=None):
    if not jobs:
        return []

    results = {}
    effective_workers = max(1, min(max_workers, len(jobs)))

    with ThreadPoolExecutor(max_workers=effective_workers) as executor:
        future_to_job = {executor.submit(worker, job): job for job in jobs}

        for future in as_completed(future_to_job):
            job = future_to_job[future]
            try:
                result = future.result()
            except Exception as exc:
                _log(f"  [{job['index']}] ✗ (Erro: {exc})")
                if progress_callback:
                    progress_callback(
                        {
                            "event": "chunk_error",
                            "index": job["index"],
                            "text": job["text"],
                            "error": str(exc),
                            "path": job["path"],
                        }
                    )
            else:
                results[job["index"]] = result
                if progress_callback:
                    progress_callback(
                        {
                            "event": "chunk_completed",
                            "index": job["index"],
                            "text": job["text"],
                            "path": job["path"],
                            "paragraph_end": job["paragraph_end"],
                        }
                    )

    return [results[index] for index in sorted(results)]


def _get_kokoro_pipeline():
    """Inicializa pipeline Kokoro (lazy loading)"""
    pipeline = getattr(_thread_state, "kokoro_pipeline", None)
    if pipeline is None:
        from kokoro import KPipeline

        pipeline = KPipeline(lang_code=KOKORO_CONFIG["lang_code"])
        _thread_state.kokoro_pipeline = pipeline
    return pipeline


def _get_xtts_model():
    """Inicializa modelo XTTS v2 (lazy loading)"""
    model = getattr(_thread_state, "xtts_model", None)
    if model is None:
        from TTS.api import TTS

        device = "cuda" if XTTS_CONFIG["device"] == "cuda" else "cpu"
        model = TTS(XTTS_CONFIG["model_name"]).to(device)
        _thread_state.xtts_model = model
    return model


def _get_piper_voice(voice):
    cache = getattr(_thread_state, "piper_voices", None)
    if cache is None:
        cache = {}
        _thread_state.piper_voices = cache

    if voice not in cache:
        from piper.voice import PiperVoice

        cache[voice] = PiperVoice.load(voice)

    return cache[voice]


def generate(
    chunks,
    output_dir="audio",
    model=None,
    speaker_wav=None,
    voice=None,
    speed=None,
    start_at=1,
    max_workers=None,
    progress_callback=None,
):
    """
    Gera arquivos WAV a partir de chunks de texto.

    Args:
        chunks: Lista de strings de texto
        output_dir: Diretório para salvar arquivos WAV
        model: 'kokoro', 'xtts', 'edge', 'edge-xtts' ou 'piper'
        speaker_wav: Caminho do arquivo WAV de referência (para XTTS v2)
        voice: Voz a usar (para Kokoro, ex: 'pf_dora')
        speed: Velocidade de fala (para Kokoro, ex: 1.0)
        start_at: Número 1-based do primeiro chunk a gerar
        max_workers: Limite de concorrência para geração dos chunks

    Returns:
        Lista de registros com caminho do arquivo WAV e metadados do chunk

    Raises:
        ValueError: Se parâmetros inválidos forem fornecidos
    """
    # Usar padrões da configuração
    if model is None:
        model = "kokoro"
    if speed is None:
        speed = KOKORO_CONFIG["speed"]
    voice = resolve_voice(model, voice)

    os.makedirs(output_dir, exist_ok=True)

    if start_at < 1:
        raise ValueError("start_at deve ser maior ou igual a 1")

    worker_count = _resolve_worker_count(model, max_workers)

    if model == "kokoro":
        return _generate_kokoro(
            chunks,
            output_dir,
            voice,
            speed,
            start_at,
            worker_count,
            progress_callback=progress_callback,
        )
    elif model == "xtts":
        if not speaker_wav:
            raise ValueError(
                "XTTS v2 requer 'speaker_wav' (arquivo WAV de referência de 10-30 segundos)"
            )
        return _generate_xtts(
            chunks,
            output_dir,
            speaker_wav,
            start_at,
            worker_count,
            progress_callback=progress_callback,
        )
    elif model == "edge":
        return _generate_edge(
            chunks,
            output_dir,
            voice,
            start_at,
            worker_count,
            progress_callback=progress_callback,
        )
    elif model == "edge-xtts":
        return _generate_edge_xtts(
            chunks,
            output_dir,
            start_at,
            worker_count,
            progress_callback=progress_callback,
        )
    elif model == "piper":
        return _generate_piper(
            chunks,
            output_dir,
            voice,
            start_at,
            worker_count,
            progress_callback=progress_callback,
        )
    else:
        raise ValueError(
            f"Modelo desconhecido: {model}. Use 'kokoro', 'xtts', 'edge', 'edge-xtts' ou 'piper'"
        )


def _generate_kokoro(
    chunks,
    output_dir,
    voice,
    speed,
    start_at=1,
    max_workers=1,
    progress_callback=None,
):
    """Gera áudio com Kokoro TTS"""
    jobs = _build_chunk_jobs(chunks, output_dir, start_at)

    def worker(job):
        pipeline = _get_kokoro_pipeline()
        _log(f"  [{job['index']}] Kokoro ({voice}) - {len(job['text'])} chars")
        audio_segments = []

        for _, _, audio in pipeline(job["text"], voice=voice, speed=speed):
            audio_segments.append(audio)

        if not audio_segments:
            raise RuntimeError("Nenhum segmento de áudio foi gerado")

        combined = np.concatenate(audio_segments)
        sf.write(job["path"], combined, 24000)  # 24 kHz
        _log(f"  [{job['index']}] ✓")
        return {
            "path": job["path"],
            "paragraph_end": job["paragraph_end"],
            "index": job["index"],
        }

    files = _run_chunk_jobs(jobs, worker, max_workers, progress_callback)
    return [
        {"path": item["path"], "paragraph_end": item["paragraph_end"]}
        for item in files
    ]


def _generate_xtts(
    chunks,
    output_dir,
    speaker_wav,
    start_at=1,
    max_workers=1,
    progress_callback=None,
):
    """Gera áudio com XTTS v2 (clonagem de voz)"""
    jobs = _build_chunk_jobs(chunks, output_dir, start_at)

    def worker(job):
        tts = _get_xtts_model()
        _log(f"  [{job['index']}] XTTS v2 (clonagem) - {len(job['text'])} chars")
        tts.tts_to_file(
            text=job["text"], file_path=job["path"], speaker_wav=speaker_wav, language="pt"
        )
        _log(f"  [{job['index']}] ✓")
        return {
            "path": job["path"],
            "paragraph_end": job["paragraph_end"],
            "index": job["index"],
        }

    files = _run_chunk_jobs(jobs, worker, max_workers, progress_callback)
    return [
        {"path": item["path"], "paragraph_end": item["paragraph_end"]}
        for item in files
    ]


def _generate_edge(
    chunks,
    output_dir,
    voice=None,
    start_at=1,
    max_workers=1,
    progress_callback=None,
):
    """Gera áudio com Edge-TTS (online, pt-BR)"""
    try:
        import edge_tts
    except ImportError:
        raise ImportError(
            "edge-tts não instalado. Execute: uv sync --extra edge "
            "(ou uv sync --all-extras)"
        )

    from pydub import AudioSegment

    if not voice:
        voice = EDGE_CONFIG["voice"]

    jobs = _build_chunk_jobs(chunks, output_dir, start_at)

    async def _synthesize(text, output_path_mp3, voice_selected):
        """Função assíncrona para sintetizar com Edge-TTS"""
        communicate = edge_tts.Communicate(
            text,
            voice=voice_selected,
            rate=str(EDGE_CONFIG["rate"]),
            pitch=str(EDGE_CONFIG["pitch"]),
        )
        await communicate.save(output_path_mp3)

    def worker(job):
        voice_label = voice.split("-")[-1].replace("Neural", "")
        _log(
            f"  [{job['index']}] Edge-TTS ({voice_label}) - {len(job['text'])} chars"
        )
        try:
            asyncio.run(_synthesize(job["text"], job["temp_mp3"], voice))
            audio = AudioSegment.from_mp3(job["temp_mp3"])
            audio.export(job["path"], format="wav")
        finally:
            if os.path.exists(job["temp_mp3"]):
                os.remove(job["temp_mp3"])

        _log(f"  [{job['index']}] ✓")
        return {
            "path": job["path"],
            "paragraph_end": job["paragraph_end"],
            "index": job["index"],
        }

    files = _run_chunk_jobs(jobs, worker, max_workers, progress_callback)
    return [
        {"path": item["path"], "paragraph_end": item["paragraph_end"]}
        for item in files
    ]


def _generate_edge_xtts(
    chunks,
    output_dir,
    start_at=1,
    max_workers=1,
    progress_callback=None,
):
    """
    Gera áudio combinando Edge-TTS (referência) + XTTS v2 (clonagem).

    Fluxo:
    1. Gera áudio de referência com Edge-TTS Francisca (MP3)
    2. Converte MP3 para WAV
    3. Usa esse WAV como speaker_wav no XTTS v2
    4. Sintetiza todos os chunks com XTTS usando a voz clonada
    """
    try:
        import edge_tts
    except ImportError:
        raise ImportError(
            "edge-tts não instalado. Execute: uv sync --extra edge-xtts "
            "(ou uv sync --all-extras)"
        )

    from pydub import AudioSegment

    # Etapa 1: Gerar áudio de referência com Edge-TTS
    print("🔹 Etapa 1: Gerando áudio de referência com Edge-TTS...")
    ref_text = "Olá, meu nome é Francisca. Como posso ajudar você hoje?"
    ref_mp3_path = f"{output_dir}/.edge_reference.mp3"
    ref_wav_path = f"{output_dir}/.edge_reference.wav"

    async def _synthesize_ref():
        communicate = edge_tts.Communicate(
            ref_text,
            voice=EDGE_XTTS_CONFIG["edge_voice"],
            rate=str(EDGE_XTTS_CONFIG["edge_rate"]),
            pitch=str(EDGE_XTTS_CONFIG["edge_pitch"]),
        )
        await communicate.save(ref_mp3_path)

    try:
        asyncio.run(_synthesize_ref())
        print("   ✓ Áudio de referência gerado (MP3)")

        # Converter MP3 para WAV (XTTS requer WAV)
        print("   ⚙️  Convertendo MP3 → WAV...")
        audio = AudioSegment.from_mp3(ref_mp3_path)
        audio.export(ref_wav_path, format="wav")
        os.remove(ref_mp3_path)  # Limpar MP3 temporário
        print(f"   ✓ Convertido para WAV: {ref_wav_path}")
    except Exception as e:
        print(f"   ✗ Erro ao gerar referência: {e}")
        raise

    ref_path = ref_wav_path

    # Etapa 2: Gerar áudio final com XTTS usando a voz clonada
    print("🔹 Etapa 2: Sintetizando com XTTS v2 (clonando voz de Francisca)...")
    jobs = _build_chunk_jobs(chunks, output_dir, start_at)

    def worker(job):
        tts = _get_xtts_model()
        _log(
            f"  [{job['index']}] XTTS v2 (Francisca clonada) - {len(job['text'])} chars"
        )
        tts.tts_to_file(
            text=job["text"],
            file_path=job["path"],
            speaker_wav=ref_path,  # Usa áudio de referência do Edge
            language=EDGE_XTTS_CONFIG["xtts_language"],
        )
        _log(f"  [{job['index']}] ✓")
        return {
            "path": job["path"],
            "paragraph_end": job["paragraph_end"],
            "index": job["index"],
        }

    files = _run_chunk_jobs(jobs, worker, max_workers, progress_callback)

    # Limpar arquivo de referência
    try:
        os.remove(ref_path)
    except OSError:
        pass

    return [
        {"path": item["path"], "paragraph_end": item["paragraph_end"]}
        for item in files
    ]


def _generate_piper(
    chunks,
    output_dir,
    voice=None,
    start_at=1,
    max_workers=1,
    progress_callback=None,
):
    """Gera áudio com Piper TTS (rápido em CPU)"""
    try:
        from piper.voice import PiperVoice
    except ImportError:
        raise ImportError("piper-tts não instalado. Execute: uv sync --extra piper")

    if PiperVoice is None:
        raise ImportError("piper-tts não instalado. Execute: uv sync --extra piper")

    import wave

    # Usar voz padrão se não especificada
    if not voice:
        voice = PIPER_CONFIG["default_voice"]

    jobs = _build_chunk_jobs(chunks, output_dir, start_at)

    def worker(job):
        voice_model = _get_piper_voice(voice)
        voice_label = voice.split("_")[1] if "_" in voice else voice
        _log(f"  [{job['index']}] Piper ({voice_label}) - {len(job['text'])} chars")

        with wave.open(job["path"], "wb") as wav_file:
            voice_model.synthesize(job["text"], wav_file)

        _log(f"  [{job['index']}] ✓")
        return {
            "path": job["path"],
            "paragraph_end": job["paragraph_end"],
            "index": job["index"],
        }

    files = _run_chunk_jobs(jobs, worker, max_workers, progress_callback)
    return [
        {"path": item["path"], "paragraph_end": item["paragraph_end"]}
        for item in files
    ]
