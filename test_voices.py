#!/usr/bin/env python3
"""
Script para testar diferentes vozes do Kokoro TTS
Gera amostras de áudio com diferentes vozes para comparação
"""

from kokoro import KPipeline
import soundfile as sf
import os

# Inicializar pipeline
pipeline = KPipeline(lang_code="p")

# Texto de teste
text_teste = "Olá, meu nome é assistente de voz. Como posso ajudar você hoje?"

# Diretório de saída
output_dir = "voice_samples"
os.makedirs(output_dir, exist_ok=True)

# Vozes para testar (femininas primeiro)
vozes_femininas = [
    "pf_dora",
    "pf_bella",
    "pf_grace",
    "pf_lucy",
    "pf_nova",
]

vozes_masculinas = [
    "pm_alex",
    "pm_santa",
]

print("Testando vozes do Kokoro TTS para português brasileiro...\n")
print(f"Texto: '{text_teste}'\n")

# Testar vozes femininas
print("=" * 60)
print("VOZES FEMININAS")
print("=" * 60)
for voice in vozes_femininas:
    output_path = f"{output_dir}/sample_female_{voice}.wav"
    try:
        print(f"Gerando: {voice:15} → {output_path}")
        audio_segments = []

        for _, _, audio in pipeline(text_teste, voice=voice, speed=1.0):
            audio_segments.append(audio)

        if audio_segments:
            import numpy as np

            combined = np.concatenate(audio_segments)
            sf.write(output_path, combined, 24000)
            print("  ✅ Sucesso\n")
        else:
            print("  ❌ Nenhum áudio gerado\n")
    except Exception as e:
        print(f"  ⚠️  Erro: {e}\n")

# Testar vozes masculinas
print("=" * 60)
print("VOZES MASCULINAS (para referência)")
print("=" * 60)
for voice in vozes_masculinas:
    output_path = f"{output_dir}/sample_male_{voice}.wav"
    try:
        print(f"Gerando: {voice:15} → {output_path}")
        audio_segments = []

        for _, _, audio in pipeline(text_teste, voice=voice, speed=1.0):
            audio_segments.append(audio)

        if audio_segments:
            import numpy as np

            combined = np.concatenate(audio_segments)
            sf.write(output_path, combined, 24000)
            print("  ✅ Sucesso\n")
        else:
            print("  ❌ Nenhum áudio gerado\n")
    except Exception as e:
        print(f"  ⚠️  Erro: {e}\n")

print("=" * 60)
print(f"Amostras salvas em: ./{output_dir}/")
print("=" * 60)
print("\nPróximas etapas:")
print("1. Ouça as amostras e escolha a voz que prefere")
print("2. Atualize a variável 'voice' em generate_audio.py")
print("3. Rode 'uv run main.py' novamente com a nova voz")
