# Repository Guidelines

## Project Structure & Module Organization
- `main.py` is the CLI entry point for Markdown-to-audiobook conversion.
- `server.py` exposes the FastAPI web API used by the interface in `templates/`, `static/`, and `INTERFACE.md`.
- Core text/audio logic lives in `md_to_text.py`, `chunker.py`, `generate_audio.py`, and `merge_audio.py`.
- Model and voice settings are centralized in `config.py`.
- Test and helper scripts live at the repo root, including `test_xtts.py`, `test_voices.py`, and `generate_speaker_ref.py`.
- Generated assets such as `audio/`, `voice_samples/`, `audio_references/`, and `.mp3/.wav` outputs should not be treated as source files.

## Build, Test, and Development Commands
- `uv sync --extra dev` installs development tools, including `ruff`.
- `uv run main.py -i livro.md -m edge -o out.mp3 -s 35` runs the CLI with short flags.
- `uv run ruff check .` runs lint checks.
- `uv run ruff format .` formats the codebase.
- `make lint`, `make lint-fix`, and `make format` are convenience aliases for the Ruff commands.
- `python3 -m py_compile main.py server.py` is a quick syntax check when needed.

## Coding Style & Naming Conventions
- Use 4-space indentation and keep code compatible with Python 3.10+.
- Prefer descriptive snake_case for functions, variables, and filenames.
- Keep CLI flags short and predictable (`-i`, `-m`, `-o`, `-s`) and preserve existing long flags for compatibility.
- Ruff is the formatter/linter; follow its default Python style unless a file already uses a consistent local pattern.

## Testing Guidelines
- There is no formal automated test suite yet.
- Use `test_xtts.py` and `test_voices.py` for manual voice/model checks.
- Before opening a PR, run `uv run ruff check .` and `uv run ruff format .`, then sanity-check the CLI or server path you changed.

## Commit & Pull Request Guidelines
- Recent commits use short, imperative English summaries, often prefixed with `Add` or `Implement`.
- Keep commit messages focused on one change, e.g. `Add resume flag for chunk processing`.
- PRs should explain what changed, why it changed, and how it was validated.
- Include example commands for CLI/API changes and mention any generated artifacts that should be ignored.

## Security & Configuration Tips
- Do not commit large generated audio files unless they are intentional fixtures.
- Treat voice-reference files and model outputs as local build artifacts.
- Prefer updating `pyproject.toml` and `uv.lock` together when dependency changes are required.
