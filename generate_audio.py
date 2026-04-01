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
from config import KOKORO_CONFIG, XTTS_CONFIG, EDGE_CONFIG, EDGE_XTTS_CONFIG

# Lazy loading de modelos
_kokoro_pipeline = None
_xtts_model = None


def _get_kokoro_pipeline():
    """Inicializa pipeline Kokoro (lazy loading)"""
    global _kokoro_pipeline
    if _kokoro_pipeline is None:
        from kokoro import KPipeline
        _kokoro_pipeline = KPipeline(lang_code=KOKORO_CONFIG['lang_code'])
    return _kokoro_pipeline


def _get_xtts_model():
    """Inicializa modelo XTTS v2 (lazy loading)"""
    global _xtts_model
    if _xtts_model is None:
        from TTS.api import TTS
        device = "cuda" if XTTS_CONFIG['device'] == 'cuda' else "cpu"
        _xtts_model = TTS(XTTS_CONFIG['model_name']).to(device)
    return _xtts_model


def generate(chunks, output_dir="audio", model=None, speaker_wav=None, voice=None, speed=None):
    """
    Gera arquivos WAV a partir de chunks de texto.

    Args:
        chunks: Lista de strings de texto
        output_dir: Diretório para salvar arquivos WAV
        model: 'kokoro', 'xtts', 'edge', ou 'edge-xtts'
        speaker_wav: Caminho do arquivo WAV de referência (para XTTS v2)
        voice: Voz a usar (para Kokoro, ex: 'pf_dora')
        speed: Velocidade de fala (para Kokoro, ex: 1.0)

    Returns:
        Lista de caminhos dos arquivos WAV gerados

    Raises:
        ValueError: Se parâmetros inválidos forem fornecidos
    """
    # Usar padrões da configuração
    if model is None:
        model = "kokoro"
    if voice is None:
        voice = KOKORO_CONFIG['voice']
    if speed is None:
        speed = KOKORO_CONFIG['speed']

    os.makedirs(output_dir, exist_ok=True)

    if model == 'kokoro':
        return _generate_kokoro(chunks, output_dir, voice, speed)
    elif model == 'xtts':
        if not speaker_wav:
            raise ValueError(
                "XTTS v2 requer 'speaker_wav' (arquivo WAV de referência de 10-30 segundos)"
            )
        return _generate_xtts(chunks, output_dir, speaker_wav)
    elif model == 'edge':
        return _generate_edge(chunks, output_dir)
    elif model == 'edge-xtts':
        return _generate_edge_xtts(chunks, output_dir)
    else:
        raise ValueError(f"Modelo desconhecido: {model}. Use 'kokoro', 'xtts', 'edge' ou 'edge-xtts'")


def _generate_kokoro(chunks, output_dir, voice, speed):
    """Gera áudio com Kokoro TTS"""
    pipeline = _get_kokoro_pipeline()
    files = []

    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue

        path = f"{output_dir}/part_{i}.wav"
        audio_segments = []

        print(f"  [{i+1}] Kokoro ({voice}) - {len(chunk)} chars", end="")

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


def _generate_xtts(chunks, output_dir, speaker_wav):
    """Gera áudio com XTTS v2 (clonagem de voz)"""
    tts = _get_xtts_model()
    files = []

    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue

        path = f"{output_dir}/part_{i}.wav"

        print(f"  [{i+1}] XTTS v2 (clonagem) - {len(chunk)} chars", end="")

        try:
            tts.tts_to_file(
                text=chunk,
                file_path=path,
                speaker_wav=speaker_wav,
                language="pt"
            )
            files.append(path)
            print(" ✓")
        except Exception as e:
            print(f" ✗ (Erro: {e})")

    return files


def _generate_edge(chunks, output_dir):
    """Gera áudio com Edge-TTS (online, voz Francisca pt-BR)"""
    try:
        import edge_tts
    except ImportError:
        raise ImportError("edge-tts não instalado. Execute: pip install edge-tts")

    from pydub import AudioSegment
    files = []

    async def _synthesize(text, output_path_mp3):
        """Função assíncrona para sintetizar com Edge-TTS"""
        # Edge-TTS precisa de rate e pitch como strings com formato especial
        communicate = edge_tts.Communicate(
            text,
            voice=EDGE_CONFIG['voice'],
            rate=str(EDGE_CONFIG['rate']),
            pitch=str(EDGE_CONFIG['pitch'])
        )
        await communicate.save(output_path_mp3)

    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue

        path_wav = f"{output_dir}/part_{i}.wav"
        path_mp3 = f"{output_dir}/.part_{i}_edge.mp3"

        print(f"  [{i+1}] Edge-TTS (Francisca) - {len(chunk)} chars", end="")

        try:
            # Executar função assíncrona (salva como MP3)
            asyncio.run(_synthesize(chunk, path_mp3))

            # Converter MP3 para WAV (Edge-TTS salva como MP3, não WAV)
            audio = AudioSegment.from_mp3(path_mp3)
            audio.export(path_wav, format="wav")
            os.remove(path_mp3)  # Remover MP3 temporário

            files.append(path_wav)
            print(" ✓")
        except Exception as e:
            print(f" ✗ (Erro: {e})")

    return files


def _generate_edge_xtts(chunks, output_dir):
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
    print(f"🔹 Etapa 1: Gerando áudio de referência com Edge-TTS...")
    ref_text = "Olá, meu nome é Francisca. Como posso ajudar você hoje?"
    ref_mp3_path = f"{output_dir}/.edge_reference.mp3"
    ref_wav_path = f"{output_dir}/.edge_reference.wav"

    async def _synthesize_ref():
        communicate = edge_tts.Communicate(
            ref_text,
            voice=EDGE_XTTS_CONFIG['edge_voice'],
            rate=str(EDGE_XTTS_CONFIG['edge_rate']),
            pitch=str(EDGE_XTTS_CONFIG['edge_pitch'])
        )
        await communicate.save(ref_mp3_path)

    try:
        asyncio.run(_synthesize_ref())
        print(f"   ✓ Áudio de referência gerado (MP3)")

        # Converter MP3 para WAV (XTTS requer WAV)
        print(f"   ⚙️  Convertendo MP3 → WAV...")
        audio = AudioSegment.from_mp3(ref_mp3_path)
        audio.export(ref_wav_path, format="wav")
        os.remove(ref_mp3_path)  # Limpar MP3 temporário
        print(f"   ✓ Convertido para WAV: {ref_wav_path}")
    except Exception as e:
        print(f"   ✗ Erro ao gerar referência: {e}")
        raise

    ref_path = ref_wav_path

    # Etapa 2: Gerar áudio final com XTTS usando a voz clonada
    print(f"🔹 Etapa 2: Sintetizando com XTTS v2 (clonando voz de Francisca)...")

    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue

        path = f"{output_dir}/part_{i}.wav"

        print(f"  [{i+1}] XTTS v2 (Francisca clonada) - {len(chunk)} chars", end="")

        try:
            tts.tts_to_file(
                text=chunk,
                file_path=path,
                speaker_wav=ref_path,  # Usa áudio de referência do Edge
                language=EDGE_XTTS_CONFIG['xtts_language']
            )
            files.append(path)
            print(" ✓")
        except Exception as e:
            print(f" ✗ (Erro: {e})")

    # Limpar arquivo de referência
    try:
        os.remove(ref_path)
    except:
        pass

    return files
