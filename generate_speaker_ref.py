#!/usr/bin/env python3
"""
Gera arquivo de áudio de referência usando Edge-TTS
para usar como speaker_wav em XTTS v2 ou outros modelos de clonagem.

O arquivo gerado terá nome com referência ao modelo que o gerou.

Uso:
  python3 generate_speaker_ref.py
"""

import asyncio
import os
from datetime import datetime

try:
    import edge_tts
except ImportError:
    print("❌ edge-tts não instalado. Execute: pip install edge-tts")
    exit(1)


async def generate_speaker_reference():
    """Gera áudio de referência com Edge-TTS"""

    # Configuração
    voice = "pt-BR-FranciscaNeural"
    rate = "+0%"
    pitch = "+0Hz"

    # Texto natural para capturar características da voz
    text = """
    Olá, meu nome é Francisca.
    Sou uma assistente de voz baseada em inteligência artificial da Microsoft.
    Posso ajudá-lo com informações, tarefas e muito mais.
    Minha voz foi sintetizada usando o serviço de texto para fala do Microsoft Edge.
    Obrigada por usar meus serviços.
    """

    # Nome do arquivo com referência ao modelo
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename_mp3 = f"speaker_ref_edge-tts_francisca_{timestamp}.mp3"
    output_path_mp3 = os.path.join("audio_references", filename_mp3)

    # Arquivo temporário em WAV
    filename_wav = f".speaker_ref_edge-tts_francisca_{timestamp}.wav"
    output_path_wav = os.path.join("audio_references", filename_wav)

    # Criar diretório se não existir
    os.makedirs("audio_references", exist_ok=True)

    print("🎤 Gerando áudio de referência com Edge-TTS")
    print(f"   Voz: {voice}")
    print(f"   Taxa: {rate}")
    print(f"   Tom: {pitch}")
    print(f"   Arquivo: {output_path_mp3}")
    print()

    # Gerar áudio
    try:
        communicate = edge_tts.Communicate(
            text=text, voice=voice, rate=rate, pitch=pitch
        )

        print("🔄 Sintetizando áudio...")
        await communicate.save(output_path_wav)

        # Converter WAV para MP3
        print("🔄 Convertendo WAV → MP3...")
        from pydub import AudioSegment

        audio = AudioSegment.from_wav(output_path_wav)
        audio.export(output_path_mp3, format="mp3", bitrate="192k")
        os.remove(output_path_wav)  # Remover WAV temporário

        # Informações do arquivo
        file_size = os.path.getsize(output_path_mp3) / 1024
        print("✅ Áudio gerado com sucesso!")
        print(f"   📁 Localização: {output_path_mp3}")
        print(f"   📊 Tamanho: {file_size:.1f} KB")

        print("\n💡 Como usar com XTTS v2:")
        print(
            f"   uv run main.py livro.md --model xtts --speaker-wav {output_path_mp3}"
        )

        print("\n📝 Nome do arquivo indica:")
        print("   - speaker_ref: arquivo de referência de voz")
        print("   - edge-tts: gerado pelo Edge-TTS")
        print("   - francisca: voz feminina Francisca")
        print("   - timestamp: data/hora de geração")

        return output_path_mp3

    except Exception as e:
        print(f"❌ Erro ao gerar áudio: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(generate_speaker_reference())
