#!/usr/bin/env python3
"""
Script para testar XTTS v2 com clonagem de voz.

REQUISITO: Instalar dependências XTTS
  uv sync --extra xtts

OPÇÃO 1: Usar um arquivo WAV como speaker de referência
  python3 test_xtts.py --speaker-wav sua_voz.wav --text "Olá, mundo!"

OPÇÃO 2: Testar com um arquivo Markdown completo
  python3 test_xtts.py --speaker-wav sua_voz.wav --input livro.md -o saida.mp3

REQUISITOS do arquivo WAV:
  - Duração: 10-30 segundos
  - Formato: WAV mono
  - Qualidade: voz limpa, sem ruído de fundo
  - Idioma: português brasileiro
"""

import argparse
import sys
import os

try:
    from TTS.api import TTS
except ImportError:
    print("❌ Erro: XTTS v2 não instalado!")
    print("   Execute: uv sync --extra xtts")
    sys.exit(1)

from md_to_text import clean_markdown
from chunker import split_text
from merge_audio import merge


def test_single_text(speaker_wav, text, output, device="cpu"):
    """Testa XTTS v2 com um texto único."""
    print("\n🎤 Testando XTTS v2 com clonagem de voz")
    print(f"   Speaker: {speaker_wav}")
    print(f"   Dispositivo: {device.upper()}")
    print(f"   Texto: {text[:60]}...")

    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

    print("\n🔊 Sintetizando áudio...")
    tts.tts_to_file(text=text, file_path=output, speaker_wav=speaker_wav, language="pt")

    file_size = os.path.getsize(output) / (1024 * 1024)
    print(f"✅ Áudio gerado: {output}")
    print(f"   Tamanho: {file_size:.2f} MB")


def test_markdown(speaker_wav, markdown_file, output, device="cpu"):
    """Testa XTTS v2 com arquivo Markdown completo."""
    print(f"\n📖 Lendo: {markdown_file}")
    with open(markdown_file, "r", encoding="utf-8") as f:
        md = f.read()

    print("🧹 Limpando Markdown...")
    text = clean_markdown(md)

    print("✂️  Dividindo em chunks...")
    chunks = split_text(text)

    print(f"🎤 Gerando áudio com XTTS v2 (clonagem) - {len(chunks)} chunks...")
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

    files = []
    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue

        chunk_path = f"audio/xtts_part_{i}.wav"
        os.makedirs("audio", exist_ok=True)

        print(f"  [{i + 1}/{len(chunks)}] {len(chunk)} chars", end="")

        try:
            tts.tts_to_file(
                text=chunk, file_path=chunk_path, speaker_wav=speaker_wav, language="pt"
            )
            files.append(chunk_path)
            print(" ✓")
        except Exception as e:
            print(f" ✗ ({e})")

    if files:
        print(f"\n🔀 Mesclando {len(files)} arquivos...")
        merge(files, output=output, provider="xtts", model="XTTS v2", voice="clonagem")

        file_size = os.path.getsize(output) / (1024 * 1024)
        print(f"✅ Audiobook gerado: {output}")
        print(f"   Tamanho: {file_size:.2f} MB")
    else:
        print("❌ Nenhum áudio foi gerado!")


def main():
    parser = argparse.ArgumentParser(
        description="Testa XTTS v2 com clonagem de voz",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    parser.add_argument(
        "--speaker-wav",
        required=True,
        help="Arquivo WAV de referência (10-30 seg, voz feminina pt-BR)",
    )

    parser.add_argument("--text", help="Texto único para testar")

    parser.add_argument(
        "--input", help="Arquivo Markdown para processar (alternativa a --text)"
    )

    parser.add_argument(
        "-o",
        "--output",
        default="teste_xtts.mp3",
        help="Arquivo de saída (padrão: teste_xtts.mp3)",
    )

    parser.add_argument(
        "--device",
        choices=["cpu", "cuda"],
        default="cpu",
        help="Dispositivo (cpu=mais lento, cuda=GPU=mais rápido)",
    )

    args = parser.parse_args()

    # Validações
    if not os.path.exists(args.speaker_wav):
        print(
            f"❌ Erro: Speaker WAV não encontrado: {args.speaker_wav}", file=sys.stderr
        )
        sys.exit(1)

    if args.input and not os.path.exists(args.input):
        print(
            f"❌ Erro: Arquivo Markdown não encontrado: {args.input}", file=sys.stderr
        )
        sys.exit(1)

    if not args.text and not args.input:
        print("❌ Erro: Forneça --text ou --input", file=sys.stderr)
        sys.exit(1)

    # Testar
    try:
        if args.text:
            test_single_text(args.speaker_wav, args.text, args.output, args.device)
        else:
            test_markdown(args.speaker_wav, args.input, args.output, args.device)

        print("\n🎉 Teste concluído!")
        print("   Compare com: audiobook.mp3 (Kokoro)")
        print(f"   Resultado: {args.output} (XTTS v2)")

    except Exception as e:
        print(f"❌ Erro: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
