#!/usr/bin/env python3
"""
Bridge de desktop para o app Tauri.

Recebe entradas Markdown, gera áudio com o pipeline atual e emite eventos JSON
em stdout para o frontend acompanhar progresso e logs.
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

from chunker import split_text
from config import resolve_voice
from generate_audio import generate
from md_to_text import clean_markdown
from merge_audio import merge


@dataclass
class Task:
    source_path: Path
    output_path: Path
    chunks: list
    start_at: int

    @property
    def chunk_total(self) -> int:
        return max(0, len(self.chunks) - self.start_at + 1)


def emit(event: str, **payload):
    data = {"event": event, **payload}
    print(json.dumps(data, ensure_ascii=False), flush=True)


def model_name(model: str) -> str:
    if model == "kokoro":
        return "Kokoro-82M"
    if model == "xtts":
        return "XTTS v2"
    if model == "edge":
        return "Edge-TTS"
    if model == "edge-xtts":
        return "Edge-TTS + XTTS v2"
    if model == "piper":
        return "Piper TTS"
    return model.upper()


def voice_label(model: str, voice: str | None) -> str:
    if model == "xtts":
        return "clonagem"
    if model == "edge-xtts":
        return "Francisca clonada"
    if model == "edge":
        return "Francisca" if not voice else voice
    return voice or "padrão"


def expand_inputs(raw_inputs: list[Path]) -> list[Path]:
    files: list[Path] = []

    for item in raw_inputs:
        if not item.exists():
            raise FileNotFoundError(f"Entrada não encontrada: {item}")

        if item.is_dir():
            md_files = sorted(item.glob("*.md"))
            if not md_files:
                raise ValueError(f"Nenhum arquivo .md encontrado em {item}")
            files.extend(md_files)
        else:
            files.append(item)

    if not files:
        raise ValueError("Nenhuma entrada Markdown foi encontrada")

    return files


def build_tasks(files: list[Path], output_dir: Path, start_at: int) -> list[Task]:
    tasks: list[Task] = []
    used_names: dict[str, int] = {}
    multi_file_mode = len(files) > 1

    if multi_file_mode:
        if start_at < 1:
            raise ValueError("--start-at deve ser maior ou igual a 1")
        if start_at > len(files):
            raise ValueError(
                f"--start-at={start_at} é maior que a quantidade de arquivos ({len(files)})"
            )
        files = files[start_at - 1 :]

    for source_path in files:
        markdown = source_path.read_text(encoding="utf-8")
        text = clean_markdown(markdown)
        chunks = split_text(text)
        if not chunks:
            raise ValueError(f"Nenhum conteúdo útil encontrado em {source_path}")

        output_name = source_path.stem
        count = used_names.get(output_name, 0)
        used_names[output_name] = count + 1
        if count:
            output_name = f"{output_name}_{count + 1}"

        tasks.append(
            Task(
                source_path=source_path,
                output_path=output_dir / f"{output_name}.mp3",
                chunks=chunks,
                start_at=start_at if not multi_file_mode else 1,
            )
        )

    if not multi_file_mode and tasks[0].start_at > len(tasks[0].chunks):
        raise ValueError(
            f"--start-at={tasks[0].start_at} é maior que a quantidade de chunks ({len(tasks[0].chunks)})"
        )

    return tasks


def build_summary(tasks: list[Task]) -> tuple[int, int]:
    total_files = len(tasks)
    total_chunks = sum(task.chunk_total for task in tasks)
    return total_files, total_chunks


def main() -> int:
    parser = argparse.ArgumentParser(description="Bridge desktop Tauri para TTS")
    parser.add_argument("--input", dest="inputs", action="append", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", default="kokoro")
    parser.add_argument("--voice", default=None)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--speaker-wav", default=None)
    parser.add_argument("--start-at", type=int, default=1)
    parser.add_argument("--max-workers", type=int, default=None)
    args = parser.parse_args()

    raw_inputs = [Path(item).expanduser() for item in args.inputs]
    output_dir = Path(args.output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not (0.5 <= args.speed <= 2.0):
        raise ValueError("speed deve estar entre 0.5 e 2.0")

    if args.model == "xtts" and not args.speaker_wav:
        raise ValueError("XTTS requer --speaker-wav")

    if args.speaker_wav and not Path(args.speaker_wav).exists():
        raise FileNotFoundError(
            f"Arquivo de referência não encontrado: {args.speaker_wav}"
        )

    voice = resolve_voice(args.model, args.voice)

    files = expand_inputs(raw_inputs)
    tasks = build_tasks(files, output_dir, args.start_at)
    total_files, total_chunks = build_summary(tasks)

    emit(
        "job_started",
        message="Fila montada. Iniciando conversão.",
        total_files=total_files,
        total_chunks=total_chunks,
        output_dir=str(output_dir),
    )

    completed_chunks = 0
    output_paths: list[str] = []
    lock = threading.Lock()

    try:
        for file_index, task in enumerate(tasks, start=1):
            emit(
                "file_started",
                message=f"Processando {task.source_path.name}",
                file_index=file_index,
                total_files=total_files,
                file_name=task.source_path.name,
                chunk_total=task.chunk_total,
                completed_chunks=completed_chunks,
                total_chunks=total_chunks,
            )

            work_dir = Path(
                tempfile.mkdtemp(prefix=f"tts_desktop_{task.source_path.stem}_")
            )
            try:
                chunk_offset = task.start_at
                file_chunks = task.chunks[chunk_offset - 1 :]
                file_total = len(file_chunks)

                def progress_callback(event: dict):
                    nonlocal completed_chunks

                    if event.get("event") == "chunk_completed":
                        with lock:
                            completed_chunks += 1
                            emit(
                                "chunk_progress",
                                message=event.get("text", "")[:120],
                                file_index=file_index,
                                total_files=total_files,
                                file_name=task.source_path.name,
                                chunk_index=event.get("index", completed_chunks),
                                chunk_total=file_total,
                                completed_chunks=completed_chunks,
                                total_chunks=total_chunks,
                                paragraph_end=bool(event.get("paragraph_end")),
                            )
                    elif event.get("event") == "chunk_error":
                        emit(
                            "error",
                            message=event.get("error", "Erro ao gerar chunk"),
                            file_index=file_index,
                            total_files=total_files,
                            file_name=task.source_path.name,
                            chunk_index=event.get("index"),
                            completed_chunks=completed_chunks,
                            total_chunks=total_chunks,
                            output_paths=output_paths,
                            progress=(completed_chunks / total_chunks)
                            if total_chunks
                            else 0.0,
                        )

                generated = generate(
                    task.chunks,
                    output_dir=str(work_dir),
                    model=args.model,
                    speaker_wav=args.speaker_wav,
                    voice=voice,
                    speed=args.speed,
                    start_at=chunk_offset,
                    max_workers=args.max_workers,
                    progress_callback=progress_callback,
                )

                expected_chunks = task.chunk_total
                if len(generated) != expected_chunks:
                    raise RuntimeError(
                        f"Nem todos os chunks foram gerados para {task.source_path.name} "
                        f"({len(generated)}/{expected_chunks})"
                    )

                emit(
                    "file_merging",
                    message=f"Mesclando {task.source_path.name}",
                    file_index=file_index,
                    total_files=total_files,
                    file_name=task.source_path.name,
                    completed_chunks=completed_chunks,
                    total_chunks=total_chunks,
                )

                merge(
                    generated,
                    output=str(task.output_path),
                    provider=args.model,
                    model=model_name(args.model),
                    voice=voice_label(args.model, voice),
                )

                output_paths.append(str(task.output_path))
                emit(
                    "file_completed",
                    message=f"{task.source_path.name} concluído",
                    file_index=file_index,
                    total_files=total_files,
                    file_name=task.source_path.name,
                    output_path=str(task.output_path),
                    completed_chunks=completed_chunks,
                    total_chunks=total_chunks,
                    progress=(completed_chunks / total_chunks) if total_chunks else 1.0,
                )
            finally:
                shutil.rmtree(work_dir, ignore_errors=True)

        emit(
            "job_completed",
            message="Conversão finalizada com sucesso.",
            output_paths=output_paths,
            progress=1.0,
            total_files=total_files,
            total_chunks=total_chunks,
        )
        return 0
    except Exception as exc:
        emit(
            "error",
            message=str(exc),
            output_paths=output_paths,
            total_files=total_files,
            total_chunks=total_chunks,
            progress=(completed_chunks / total_chunks) if total_chunks else 0.0,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
