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

  # Pasta com vários .md
  uv run main.py /meus/livros --model edge --output-dir /meus/livros/audio

  # Kokoro com voz diferente e velocidade customizada
  uv run main.py livro.md --voice pm_alex --speed 0.9
"""

import argparse
import sys
import os
import shutil
import tempfile
from pathlib import Path

from md_to_text import clean_markdown
from chunker import split_text
from generate_audio import generate
from merge_audio import merge
from config import DEFAULT_MODEL, KOKORO_CONFIG, PIPER_CONFIG, resolve_voice


def _process_single_file(
    input_path: Path,
    output_path: Path,
    model: str,
    speaker_wav,
    voice: str,
    speed: float,
    quiet: bool,
    start_at: int = 1,
):
    """Processa um único arquivo Markdown e gera um MP3 final."""
    voice = resolve_voice(model, voice)

    if not quiet:
        print(f"📖 Lendo: {input_path}")

    with open(input_path, "r", encoding="utf-8") as f:
        md = f.read()

    if not quiet:
        print("🧹 Limpando Markdown...")
    text = clean_markdown(md)

    if not quiet:
        print("✂️  Dividindo em chunks...")
    chunks = split_text(text)

    if start_at < 1:
        raise ValueError("start_at deve ser maior ou igual a 1")

    if start_at > len(chunks):
        raise ValueError(
            f"start_at={start_at} é maior que a quantidade de chunks ({len(chunks)})"
        )

    if not quiet:
        print(
            f"🎤 Gerando áudio ({model.upper()}, {len(chunks)} chunks, a partir do {start_at})..."
        )

    work_dir = tempfile.mkdtemp(prefix=f"tts_{input_path.stem}_")
    try:
        files = generate(
            chunks,
            output_dir=work_dir,
            model=model,
            speaker_wav=speaker_wav,
            voice=voice,
            speed=speed,
            start_at=start_at,
        )

        if not files:
            raise RuntimeError("Nenhum áudio foi gerado")

        if not quiet:
            print(f"🔀 Mesclando {len(files)} arquivos de áudio...")

        if output_path.parent:
            output_path.parent.mkdir(parents=True, exist_ok=True)

        if model == "kokoro":
            model_name = "Kokoro-82M"
            voice_label = voice
        elif model == "xtts":
            model_name = "XTTS v2"
            voice_label = "clonagem"
        elif model == "edge":
            model_name = "Edge-TTS"
            voice_label = "Francisca"
        elif model == "edge-xtts":
            model_name = "Edge-TTS + XTTS v2"
            voice_label = "Francisca clonada"
        else:
            model_name = model.upper()
            voice_label = voice

        merge(
            files,
            output=str(output_path),
            provider=model,
            model=model_name,
            voice=voice_label,
        )

        output_size = os.path.getsize(output_path) / (1024 * 1024)
        if not quiet:
            print(f"✅ Gerado: {output_path} ({output_size:.1f} MB)")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(
        description="Converte Markdown para Audiobook usando TTS",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # Argumentos posicionais
    parser.add_argument(
        "input_positional",
        nargs="?",
        help="Arquivo ou pasta Markdown de entrada (uso antigo, opcional)",
    )

    parser.add_argument(
        "-i", "--input", dest="input_flag", help="Arquivo ou pasta Markdown de entrada"
    )

    # Argumentos opcionais
    parser.add_argument(
        "-o",
        "--output",
        default="audiobook.mp3",
        help="Arquivo MP3 de saída (padrão: audiobook.mp3)",
    )

    parser.add_argument(
        "--output-dir",
        help="Diretório de saída para modo pasta; no modo arquivo único salva o MP3 com o mesmo nome do .md",
    )

    parser.add_argument(
        "-m",
        "--model",
        choices=["kokoro", "xtts", "edge", "edge-xtts"],
        default=DEFAULT_MODEL,
        help=f"Modelo TTS a usar (padrão: {DEFAULT_MODEL})",
    )

    parser.add_argument(
        "--voice",
        default=None,
        help=(
            "Voz a usar. Kokoro: pf_dora, pm_alex, pm_santa; "
            f"Edge: {resolve_voice('edge')}; "
            f"Piper: {PIPER_CONFIG['default_voice']}"
        ),
    )

    parser.add_argument(
        "--speed",
        type=float,
        default=KOKORO_CONFIG["speed"],
        help=f"Velocidade de fala (0.5-2.0; padrão: {KOKORO_CONFIG['speed']})",
    )

    parser.add_argument(
        "--speaker-wav",
        help="Arquivo WAV de referência para XTTS v2 (10-30 seg, sem ruído)",
    )

    parser.add_argument(
        "--audio-dir",
        default="audio",
        help="Diretório para salvar chunks de áudio (padrão: audio)",
    )

    parser.add_argument(
        "-s",
        "--start-at",
        type=int,
        default=1,
        help="Primeiro capítulo/chunk a processar, usando índice 1-based (ex: 35 para retomar do capítulo 35)",
    )

    parser.add_argument(
        "-q", "--quiet", action="store_true", help="Suprime mensagens de progresso"
    )

    args = parser.parse_args()
    input_value = args.input_flag or args.input_positional
    if not input_value:
        print(
            "❌ Erro: informe a entrada com `-i/--input` ou como argumento posicional",
            file=sys.stderr,
        )
        sys.exit(1)
    input_path = Path(input_value)

    # Validações
    if not input_path.exists():
        print(
            f"❌ Erro: Arquivo ou pasta não encontrada: {input_value}", file=sys.stderr
        )
        sys.exit(1)

    if args.model == "xtts" and not args.speaker_wav:
        print(
            "❌ Erro: XTTS v2 requer --speaker-wav (arquivo WAV de referência)",
            file=sys.stderr,
        )
        sys.exit(1)

    if args.model == "edge-xtts" and args.speaker_wav:
        print(
            "⚠️  Aviso: --speaker-wav é ignorado com edge-xtts (usa Francisca como referência)",
            file=sys.stderr,
        )

    if args.speaker_wav and not os.path.exists(args.speaker_wav):
        print(
            f"❌ Erro: Arquivo de speaker não encontrado: {args.speaker_wav}",
            file=sys.stderr,
        )
        sys.exit(1)

    if not (0.5 <= args.speed <= 2.0):
        print("❌ Erro: Speed deve estar entre 0.5 e 2.0", file=sys.stderr)
        sys.exit(1)

    if args.start_at < 1:
        print("❌ Erro: --start-at deve ser maior ou igual a 1", file=sys.stderr)
        sys.exit(1)

    args.voice = resolve_voice(args.model, args.voice)

    try:
        if input_path.is_dir():
            md_files = sorted(input_path.glob("*.md"))
            if not md_files:
                print(
                    f"❌ Erro: Nenhum arquivo .md encontrado em {input_path}",
                    file=sys.stderr,
                )
                sys.exit(1)

            if args.start_at > len(md_files):
                print(
                    f"❌ Erro: --start-at={args.start_at} é maior que a quantidade de arquivos ({len(md_files)})",
                    file=sys.stderr,
                )
                sys.exit(1)

            output_dir = (
                Path(args.output_dir) if args.output_dir else input_path / "audio"
            )
            output_dir.mkdir(parents=True, exist_ok=True)

            if not args.quiet:
                print(f"📁 Pasta de entrada: {input_path}")
                print(f"📁 Pasta de saída: {output_dir}")
                print(f"📚 Arquivos encontrados: {len(md_files)}")

            for index, md_file in enumerate(md_files, start=1):
                if index < args.start_at:
                    continue
                output_path = output_dir / f"{md_file.stem}.mp3"
                if not args.quiet:
                    print(f"\n▶ Processando: {md_file.name} (capítulo {index})")
                _process_single_file(
                    md_file,
                    output_path,
                    args.model,
                    args.speaker_wav,
                    args.voice,
                    args.speed,
                    args.quiet,
                    start_at=1,
                )
        else:
            # Em arquivo único, o índice se aplica aos chunks internos.
            if args.output_dir:
                output_path = Path(args.output_dir) / f"{input_path.stem}.mp3"
            else:
                output_path = Path(args.output)

            _process_single_file(
                input_path,
                output_path,
                args.model,
                args.speaker_wav,
                args.voice,
                args.speed,
                args.quiet,
                start_at=args.start_at,
            )

            if not args.quiet:
                print("\n✅ Audiobook gerado com sucesso!")
                print(f"   📁 Saída: {output_path}")
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
