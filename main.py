#!/usr/bin/env python3
"""
Pipeline de Audiobook TTS - Suporta Kokoro, XTTS v2, Edge-TTS e Edge-TTS + XTTS v2

Uso:
  # Kokoro (padrão - rápido, offline)
  uv run main.py livro.md

  # Edge-TTS (online, voz Francisca pt-BR, grátis)
  uv run main.py livro.md --model edge

  # Edge-TTS + XTTS v2 (clona voz Francisca com XTTS, melhor qualidade)
  uv run main.py livro.md --model edge-xtts

  # XTTS v2 com clonagem de voz própria
  uv run main.py livro.md --model xtts --speaker-wav sua_voz.wav

  # Customize saída
  uv run main.py livro.md -o meu_audiobook.mp3

  # Kokoro com voz diferente e velocidade customizada
  uv run main.py livro.md --voice pm_alex --speed 0.9
"""

import argparse
import sys
import os
from pathlib import Path

from md_to_text import clean_markdown
from chunker import split_text
from generate_audio import generate
from merge_audio import merge
from config import DEFAULT_MODEL, KOKORO_CONFIG


def main():
    parser = argparse.ArgumentParser(
        description="Converte Markdown para Audiobook usando TTS",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    # Argumentos posicionais
    parser.add_argument(
        "input",
        help="Arquivo Markdown de entrada (ex: livro.md)"
    )

    # Argumentos opcionais
    parser.add_argument(
        "-o", "--output",
        default="audiobook.mp3",
        help="Arquivo MP3 de saída (padrão: audiobook.mp3)"
    )

    parser.add_argument(
        "--model",
        choices=["kokoro", "xtts", "edge", "edge-xtts"],
        default=DEFAULT_MODEL,
        help=f"Modelo TTS a usar (padrão: {DEFAULT_MODEL})"
    )

    parser.add_argument(
        "--voice",
        default=KOKORO_CONFIG['voice'],
        help=f"Voz a usar (Kokoro: pf_dora, pm_alex, pm_santa; padrão: {KOKORO_CONFIG['voice']})"
    )

    parser.add_argument(
        "--speed",
        type=float,
        default=KOKORO_CONFIG['speed'],
        help=f"Velocidade de fala (0.5-2.0; padrão: {KOKORO_CONFIG['speed']})"
    )

    parser.add_argument(
        "--speaker-wav",
        help="Arquivo WAV de referência para XTTS v2 (10-30 seg, sem ruído)"
    )

    parser.add_argument(
        "--audio-dir",
        default="audio",
        help="Diretório para salvar chunks de áudio (padrão: audio)"
    )

    parser.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Suprime mensagens de progresso"
    )

    args = parser.parse_args()

    # Validações
    if not os.path.exists(args.input):
        print(f"❌ Erro: Arquivo não encontrado: {args.input}", file=sys.stderr)
        sys.exit(1)

    if args.model == "xtts" and not args.speaker_wav:
        print(
            "❌ Erro: XTTS v2 requer --speaker-wav (arquivo WAV de referência)",
            file=sys.stderr
        )
        sys.exit(1)

    if args.model == "edge-xtts" and args.speaker_wav:
        print(
            "⚠️  Aviso: --speaker-wav é ignorado com edge-xtts (usa Francisca como referência)",
            file=sys.stderr
        )

    if args.speaker_wav and not os.path.exists(args.speaker_wav):
        print(f"❌ Erro: Arquivo de speaker não encontrado: {args.speaker_wav}", file=sys.stderr)
        sys.exit(1)

    if not (0.5 <= args.speed <= 2.0):
        print(f"❌ Erro: Speed deve estar entre 0.5 e 2.0", file=sys.stderr)
        sys.exit(1)

    # Processar
    try:
        if not args.quiet:
            print(f"📖 Lendo: {args.input}")

        with open(args.input, "r", encoding="utf-8") as f:
            md = f.read()

        if not args.quiet:
            print(f"🧹 Limpando Markdown...")
        text = clean_markdown(md)

        if not args.quiet:
            print(f"✂️  Dividindo em chunks...")
        chunks = split_text(text)

        if not args.quiet:
            print(f"🎤 Gerando áudio ({args.model.upper()}, {len(chunks)} chunks)...")
        files = generate(
            chunks,
            output_dir=args.audio_dir,
            model=args.model,
            speaker_wav=args.speaker_wav,
            voice=args.voice,
            speed=args.speed
        )

        if not files:
            print("❌ Erro: Nenhum áudio foi gerado", file=sys.stderr)
            sys.exit(1)

        if not args.quiet:
            print(f"🔀 Mesclando {len(files)} arquivos de áudio...")

        # Preparar metadata
        if args.model == "kokoro":
            model_name = "Kokoro-82M"
            voice_label = args.voice
        elif args.model == "xtts":
            model_name = "XTTS v2"
            voice_label = "clonagem"
        elif args.model == "edge":
            model_name = "Edge-TTS"
            voice_label = "Francisca"
        elif args.model == "edge-xtts":
            model_name = "Edge-TTS + XTTS v2"
            voice_label = "Francisca clonada"

        merge(
            files,
            output=args.output,
            provider=args.model,
            model=model_name,
            voice=voice_label
        )

        # Informações do arquivo gerado
        output_size = os.path.getsize(args.output) / (1024 * 1024)  # MB
        if not args.quiet:
            print(f"\n✅ Audiobook gerado com sucesso!")
            print(f"   📁 Saída: {args.output}")
            print(f"   📊 Tamanho: {output_size:.1f} MB")
            print(f"   🎵 Modelo: {args.model.upper()}")
            if args.model == "xtts":
                print(f"   🔊 Speaker: {args.speaker_wav}")
            else:
                print(f"   🔊 Voz: {args.voice}")
                print(f"   ⚡ Velocidade: {args.speed}x")

    except Exception as e:
        print(f"❌ Erro: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
