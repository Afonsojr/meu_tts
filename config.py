"""
Configurações do projeto TTS

Permite escolher entre:
- Kokoro TTS (padrão): Leve, voz feminina nativa pt-BR
- XTTS v2: Clonagem de voz com arquivo de referência
"""

# Modelo padrão: 'kokoro' ou 'xtts'
DEFAULT_MODEL = "kokoro"

# Configurações do Kokoro
KOKORO_CONFIG = {
    "lang_code": "p",  # 'p' = Portuguese BR
    "voice": "pf_dora",  # Voz feminina brasileira
    "speed": 1.0,  # 0.5 (mais lento) a 2.0 (mais rápido)
}

# Configurações do Edge-TTS
EDGE_CONFIG = {
    "voice": "pt-BR-FranciscaNeural",  # Voz feminina brasileira
    "rate": "+0%",  # Velocidade: "-50%", "+0%", "+50%", etc
    "pitch": "+0Hz",  # Altura: "-10Hz", "+0Hz", "+10Hz", etc
}

# Vozes disponíveis do Edge-TTS (português brasileiro)
EDGE_VOICES = {
    "pt-BR-FranciscaNeural": "Francisca (Feminina)",
    "pt-BR-BryanNeural": "Bryan (Masculino)",
    "pt-BR-AntonioNeural": "Antonio (Masculino)",
}


def resolve_voice(model, voice=None):
    """Resolve uma voz segura para o modelo informado."""
    if model == "edge":
        if voice in EDGE_VOICES:
            return voice
        return EDGE_CONFIG["voice"]

    if model == "edge-xtts":
        if voice in EDGE_VOICES:
            return voice
        return EDGE_XTTS_CONFIG["edge_voice"]

    if model == "kokoro":
        if voice in {"pf_dora", "pm_alex", "pm_santa"}:
            return voice
        return KOKORO_CONFIG["voice"]

    if model == "piper":
        if voice in PIPER_VOICES:
            return voice
        return PIPER_CONFIG["default_voice"]

    return voice


# Configurações do XTTS v2
XTTS_CONFIG = {
    "model_name": "tts_models/multilingual/multi-dataset/xtts_v2",
    "language": "pt",
    "speaker_wav": None,  # Caminho do arquivo WAV de referência (10-30 seg)
    "device": "cpu",  # 'cpu' ou 'cuda'
}

# Configurações do Edge-TTS + XTTS v2 (clonagem)
EDGE_XTTS_CONFIG = {
    "edge_voice": "pt-BR-FranciscaNeural",  # Voz de referência
    "edge_rate": "+0%",  # Velocidade da voz de referência ("+0%", "-20%", etc)
    "edge_pitch": "+0Hz",  # Altura da voz ("-10Hz", "+0Hz", etc)
    "reference_duration": 10,  # Segundos de áudio para usar como referência
    "xtts_device": "cpu",  # 'cpu' ou 'cuda'
    "xtts_language": "pt",
}

# Configurações do Piper TTS
PIPER_CONFIG = {
    "models_dir": "piper_models",  # Diretório para cachear modelos
    "default_voice": "pt-pt_tugao-medium",
    "language": "pt",
}

# Vozes disponíveis do Piper (português)
PIPER_VOICES = {
    "pt-pt_tugao-medium": "Tugão (PT) - Médio",
    "pt-pt_tugao-high": "Tugão (PT) - Alto",
}

# Configurações gerais
OUTPUT_DIR = "audio"
FINAL_OUTPUT = "audiobook.mp3"
MP3_BITRATE = "192k"
SILENCE_DURATION = 400  # ms entre chunks

# Configurações de texto
MAX_CHUNK_SIZE = 400  # caracteres
