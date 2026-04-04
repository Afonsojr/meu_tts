"""
Gerador de áudio suportando Kokoro TTS, XTTS v2, Edge-TTS e Edge-TTS + XTTS v2

Modelos disponíveis:
  - kokoro: Kokoro TTS com voz pré-treinada pt-BR
  - xtts: XTTS v2 com clonagem (precisa speaker_wav)
  - edge: Edge-TTS com voz Francisca pt-BR (online, grátis)
  - edge-xtts: Edge-TTS + XTTS v2 (gera referência do Edge, clona com XTTS)
"""

import os
import numpy as np
import soundfile as sf
import asyncio
from config import (
    KOKORO_CONFIG,
    XTTS_CONFIG,
    EDGE_CONFIG,
    EDGE_XTTS_CONFIG,
    PIPER_CONFIG,
    resolve_voice,
)

# Lazy loading de modelos
_kokoro_pipeline = None
_xtts_model = None


def _get_kokoro_pipeline():
    """Inicializa pipeline Kokoro (lazy loading)"""
    global _kokoro_pipeline
    if _kokoro_pipeline is None:
        from kokoro import KPipeline

        _kokoro_pipeline = KPipeline(lang_code=KOKORO_CONFIG["lang_code"])
    return _kokoro_pipeline


def _get_xtts_model():
    """Inicializa modelo XTTS v2 (lazy loading)"""
    global _xtts_model
    if _xtts_model is None:
        from TTS.api import TTS

        device = "cuda" if XTTS_CONFIG["device"] == "cuda" else "cpu"
        _xtts_model = TTS(XTTS_CONFIG["model_name"]).to(device)
    return _xtts_model


def generate(
    chunks,
    output_dir="audio",
    model=None,
    speaker_wav=None,
    voice=None,
    speed=None,
    start_at=1,
):
    """
    Gera arquivos WAV a partir de chunks de texto.

    Args:
        chunks: Lista de strings de texto
        output_dir: Diretório para salvar arquivos WAV
        model: 'kokoro', 'xtts', 'edge', ou 'edge-xtts'
        speaker_wav: Caminho do arquivo WAV de referência (para XTTS v2)
        voice: Voz a usar (para Kokoro, ex: 'pf_dora')
        speed: Velocidade de fala (para Kokoro, ex: 1.0)
        start_at: Número 1-based do primeiro chunk a gerar

    Returns:
        Lista de caminhos dos arquivos WAV gerados

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

    if model == "kokoro":
        return _generate_kokoro(chunks, output_dir, voice, speed, start_at)
    elif model == "xtts":
        if not speaker_wav:
            raise ValueError(
                "XTTS v2 requer 'speaker_wav' (arquivo WAV de referência de 10-30 segundos)"
            )
        return _generate_xtts(chunks, output_dir, speaker_wav, start_at)
    elif model == "edge":
        return _generate_edge(chunks, output_dir, voice, start_at)
    elif model == "edge-xtts":
        return _generate_edge_xtts(chunks, output_dir, start_at)
    elif model == "piper":
        return _generate_piper(chunks, output_dir, voice, start_at)
    else:
        raise ValueError(
            f"Modelo desconhecido: {model}. Use 'kokoro', 'xtts', 'edge', 'edge-xtts' ou 'piper'"
        )


def _generate_kokoro(chunks, output_dir, voice, speed, start_at=1):
    """Gera áudio com Kokoro TTS"""
    pipeline = _get_kokoro_pipeline()
    files = []

    for i, chunk in enumerate(chunks, start=1):
        if i < start_at:
            continue
        if not chunk.strip():
            continue

        path = f"{output_dir}/part_{i - 1}.wav"
        audio_segments = []

        print(f"  [{i}] Kokoro ({voice}) - {len(chunk)} chars", end="")

        for _, _, audio in pipeline(chunk, voice=voice, speed=speed):
            audio_segments.append(audio)

        if audio_segments:
            combined = np.concatenate(audio_segments)
            sf.write(path, combined, 24000)  # 24 kHz
            files.append(path)
            print(" ✓")
        else:
            print(" ✗")

    return files


def _generate_xtts(chunks, output_dir, speaker_wav, start_at=1):
    """Gera áudio com XTTS v2 (clonagem de voz)"""
    tts = _get_xtts_model()
    files = []

    for i, chunk in enumerate(chunks, start=1):
        if i < start_at:
            continue
        if not chunk.strip():
            continue

        path = f"{output_dir}/part_{i - 1}.wav"

        print(f"  [{i}] XTTS v2 (clonagem) - {len(chunk)} chars", end="")

        try:
            tts.tts_to_file(
                text=chunk, file_path=path, speaker_wav=speaker_wav, language="pt"
            )
            files.append(path)
            print(" ✓")
        except Exception as e:
            print(f" ✗ (Erro: {e})")

    return files


def _generate_edge(chunks, output_dir, voice=None, start_at=1):
    """Gera áudio com Edge-TTS (online, pt-BR)"""
    try:
        import edge_tts
    except ImportError:
        raise ImportError("edge-tts não instalado. Execute: pip install edge-tts")

    from pydub import AudioSegment

    # Usar voz padrão se não especificada
    if not voice:
        voice = EDGE_CONFIG["voice"]

    files = []

    async def _synthesize(text, output_path_mp3, voice_selected):
        """Função assíncrona para sintetizar com Edge-TTS"""
        # Edge-TTS precisa de rate e pitch como strings com formato especial
        communicate = edge_tts.Communicate(
            text,
            voice=voice_selected,
            rate=str(EDGE_CONFIG["rate"]),
            pitch=str(EDGE_CONFIG["pitch"]),
        )
        await communicate.save(output_path_mp3)

    for i, chunk in enumerate(chunks, start=1):
        if i < start_at:
            continue
        if not chunk.strip():
            continue

        path_wav = f"{output_dir}/part_{i - 1}.wav"
        path_mp3 = f"{output_dir}/.part_{i - 1}_edge.mp3"

        # Extrair nome da voz para exibição
        voice_label = voice.split("-")[-1].replace("Neural", "")

        print(f"  [{i}] Edge-TTS ({voice_label}) - {len(chunk)} chars", end="")

        try:
            # Executar função assíncrona (salva como MP3)
            asyncio.run(_synthesize(chunk, path_mp3, voice))

            # Converter MP3 para WAV (Edge-TTS salva como MP3, não WAV)
            audio = AudioSegment.from_mp3(path_mp3)
            audio.export(path_wav, format="wav")
            os.remove(path_mp3)  # Remover MP3 temporário

            files.append(path_wav)
            print(" ✓")
        except Exception as e:
            print(f" ✗ (Erro: {e})")

    return files


def _generate_edge_xtts(chunks, output_dir, start_at=1):
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
        raise ImportError("edge-tts não instalado. Execute: uv sync --extra edge-xtts")

    from pydub import AudioSegment

    tts = _get_xtts_model()
    files = []

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

    for i, chunk in enumerate(chunks, start=1):
        if i < start_at:
            continue
        if not chunk.strip():
            continue

        path = f"{output_dir}/part_{i - 1}.wav"

        print(f"  [{i}] XTTS v2 (Francisca clonada) - {len(chunk)} chars", end="")

        try:
            tts.tts_to_file(
                text=chunk,
                file_path=path,
                speaker_wav=ref_path,  # Usa áudio de referência do Edge
                language=EDGE_XTTS_CONFIG["xtts_language"],
            )
            files.append(path)
            print(" ✓")
        except Exception as e:
            print(f" ✗ (Erro: {e})")

    # Limpar arquivo de referência
    try:
        os.remove(ref_path)
    except OSError:
        pass

    return files


def _generate_piper(chunks, output_dir, voice=None, start_at=1):
    """Gera áudio com Piper TTS (rápido em CPU)"""
    try:
        from piper.voice import PiperVoice
    except ImportError:
        raise ImportError("piper-tts não instalado. Execute: uv sync --extra piper")

    import wave

    # Usar voz padrão se não especificada
    if not voice:
        voice = PIPER_CONFIG["default_voice"]

    files = []

    # Carregar modelo de voz uma única vez
    print(f"  🔄 Carregando modelo Piper: {voice}...")
    try:
        voice_model = PiperVoice.load(voice)
    except Exception as e:
        raise ValueError(f"Erro ao carregar modelo Piper '{voice}': {e}")

    for i, chunk in enumerate(chunks, start=1):
        if i < start_at:
            continue
        if not chunk.strip():
            continue

        path = f"{output_dir}/part_{i - 1}.wav"

        # Extrair nome da voz para exibição
        voice_label = voice.split("_")[1] if "_" in voice else voice

        print(f"  [{i}] Piper ({voice_label}) - {len(chunk)} chars", end="")

        try:
            # Sintetizar com Piper
            with wave.open(path, "wb") as wav_file:
                voice_model.synthesize(chunk, wav_file)

            files.append(path)
            print(" ✓")
        except Exception as e:
            print(f" ✗ (Erro: {e})")

    return files
