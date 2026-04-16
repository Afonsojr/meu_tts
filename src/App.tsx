import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

type VoiceEntry = {
  id: string;
  label: string;
};

type ModelEntry = {
  id: string;
  name: string;
  description: string;
  accent: string;
  supportsSpeakerWav: boolean;
  supportsSpeed: boolean;
  defaultVoice?: string | null;
  offline: boolean;
  voices: VoiceEntry[];
};

type Catalog = {
  defaultModel: string;
  models: ModelEntry[];
};

type InputPreview = {
  path: string;
  kind: "file" | "directory";
  file_count: number;
  files: string[];
};

type ConversionEvent =
  | {
      kind: "status";
      job_id: string;
      status: string;
      message: string;
      progress: number;
      current_file_index: number;
      total_files: number;
      current_file_name: string | null;
      current_chunk_index: number;
      current_chunk_total: number;
      completed_chunks: number;
      total_chunks: number;
      output_paths: string[];
      error: string | null;
    }
  | {
      kind: "log";
      job_id: string;
      message: string;
    };

type ConversionRequest = {
  inputs: string[];
  output_dir: string;
  model: string;
  voice: string | null;
  speed: number;
  speaker_wav: string | null;
  start_at: number;
  max_workers: number | null;
};

type JobState = {
  job_id: string;
  status: string;
  message: string;
  progress: number;
  current_file_index: number;
  total_files: number;
  current_file_name: string | null;
  current_chunk_index: number;
  current_chunk_total: number;
  completed_chunks: number;
  total_chunks: number;
  output_paths: string[];
  error: string | null;
};

const modelOrder = ["kokoro", "edge", "piper", "edge-xtts", "xtts"];

const defaultJobState: JobState = {
  job_id: "",
  status: "idle",
  message: "Escolha a entrada e configure a saída para começar.",
  progress: 0,
  current_file_index: 0,
  total_files: 0,
  current_file_name: null,
  current_chunk_index: 0,
  current_chunk_total: 0,
  completed_chunks: 0,
  total_chunks: 0,
  output_paths: [],
  error: null,
};

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatSelectionLabel(path: string) {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [job, setJob] = useState<JobState>(defaultJobState);
  const [logs, setLogs] = useState<string[]>([]);
  const [inputKind, setInputKind] = useState<"file" | "directory" | "files" | null>(
    null,
  );
  const [inputs, setInputs] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState<string>("");
  const [speakerWav, setSpeakerWav] = useState<string>("");
  const [model, setModel] = useState("kokoro");
  const [voiceFilter, setVoiceFilter] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [startAt, setStartAt] = useState(1);
  const [maxWorkers, setMaxWorkers] = useState(2);
  const [inputPreview, setInputPreview] = useState<InputPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    invoke<Catalog>("get_catalog")
      .then((data) => {
        setCatalog(data);
        setModel(data.defaultModel);

        const defaultModel = data.models.find((item) => item.id === data.defaultModel);
        setSelectedVoice(defaultModel?.defaultVoice ?? defaultModel?.voices[0]?.id ?? null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingCatalog(false));

    listen<ConversionEvent>("tts-event", (event) => {
      const payload = event.payload;

      if (payload.kind === "log") {
        setLogs((current) => [...current.slice(-199), payload.message]);
        return;
      }

      const { kind: _kind, ...statusPayload } = payload;
      setJob((current) => ({
        ...current,
        ...statusPayload,
      }));

      if (payload.status === "completed") {
        setBusy(false);
      }

      if (payload.status === "error") {
        setBusy(false);
        setError(payload.error ?? payload.message);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    const currentModel = catalog?.models.find((item) => item.id === model);
    if (!currentModel) {
      return;
    }

    if (currentModel.id === "xtts") {
      setSelectedVoice(null);
      return;
    }

    const voiceStillValid = currentModel.voices.some((item) => item.id === selectedVoice);
    if (!voiceStillValid) {
      setSelectedVoice(currentModel.defaultVoice ?? currentModel.voices[0]?.id ?? null);
    }
  }, [catalog, model, selectedVoice]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!inputs.length || inputKind === null) {
        setInputPreview(null);
        return;
      }

      if (inputKind === "files" && inputs.length > 1) {
        setInputPreview({
          path: inputs[0],
          kind: "directory",
          file_count: inputs.length,
          files: inputs.map((path) => formatSelectionLabel(path)),
        });
        return;
      }

      setPreviewLoading(true);
      try {
        const preview = await invoke<InputPreview>("inspect_input", {
          path: inputs[0],
        });
        if (!cancelled) {
          setInputPreview(preview);
        }
      } catch (err) {
        if (!cancelled) {
          setInputPreview(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [inputs, inputKind]);

  const currentModel = catalog?.models.find((item) => item.id === model) ?? null;
  const availableVoices = useMemo(() => {
    if (!currentModel) {
      return [];
    }

    const query = voiceFilter.trim().toLowerCase();
    return currentModel.voices.filter((voice) => {
      if (!query) {
        return true;
      }

      return (
        voice.id.toLowerCase().includes(query) ||
        voice.label.toLowerCase().includes(query)
      );
    });
  }, [currentModel, voiceFilter]);

  const selectedPreview = useMemo(() => {
    if (!inputs.length) {
      return "Nenhuma entrada selecionada";
    }

    if (inputKind === "directory") {
      return `${formatSelectionLabel(inputs[0])} · pasta`;
    }

    if (inputKind === "file") {
      return `${formatSelectionLabel(inputs[0])} · arquivo`;
    }

    return `${inputs.length} arquivos selecionados`;
  }, [inputKind, inputs]);

  const totalProgress = job.totalChunks > 0 ? job.completedChunks / job.totalChunks : job.progress;
  const visibleFiles = inputPreview?.files.slice(0, 3) ?? [];

  async function chooseFiles() {
    try {
      const picked = await open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: "Markdown",
            extensions: ["md", "markdown"],
          },
        ],
      });

      if (!picked) {
        return;
      }

      const normalized = Array.isArray(picked) ? picked : [picked];
      setInputs(normalized);
      setInputKind(normalized.length > 1 ? "files" : "file");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function chooseFolder() {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
      });

      if (!picked || Array.isArray(picked)) {
        return;
      }

      setInputs([picked]);
      setInputKind("directory");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function chooseOutputDir() {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
      });

      if (!picked || Array.isArray(picked)) {
        return;
      }

      setOutputDir(picked);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function chooseSpeakerWav() {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "WAV",
            extensions: ["wav"],
          },
        ],
      });

      if (!picked || Array.isArray(picked)) {
        return;
      }

      setSpeakerWav(picked);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function resetForm() {
    setInputs([]);
    setInputKind(null);
    setOutputDir("");
    setSpeakerWav("");
    setModel(catalog?.defaultModel ?? "kokoro");
    const fallbackModel = catalog?.models.find((item) => item.id === (catalog?.defaultModel ?? "kokoro"));
    setSelectedVoice(fallbackModel?.defaultVoice ?? fallbackModel?.voices[0]?.id ?? null);
    setVoiceFilter("");
    setSpeed(1);
    setStartAt(1);
    setMaxWorkers(2);
    setJob(defaultJobState);
    setLogs([]);
    setError(null);
  }

  async function startConversion() {
    if (!inputs.length) {
      setError("Escolha um arquivo ou uma pasta de entrada.");
      return;
    }

    if (!outputDir) {
      setError("Escolha a pasta de saída.");
      return;
    }

    if (currentModel?.supportsSpeakerWav && !speakerWav) {
      setError("O modelo selecionado requer um arquivo WAV de referência.");
      return;
    }

    const request: ConversionRequest = {
      inputs,
      output_dir: outputDir,
      model,
      voice: currentModel?.supportsSpeakerWav ? null : selectedVoice,
      speed,
      speaker_wav: currentModel?.supportsSpeakerWav ? speakerWav || null : null,
      start_at: startAt,
      max_workers: Number.isFinite(maxWorkers) && maxWorkers > 0 ? maxWorkers : null,
    };

    try {
      setBusy(true);
      setError(null);
      setLogs([]);
      setJob({
        ...defaultJobState,
        status: "queued",
        message: "Fila preparada. Iniciando conversão...",
        progress: 0,
      });

      const response = await invoke<{ job_id: string }>("start_conversion", {
        request,
      });

      setJob((current) => ({
        ...current,
        job_id: response.job_id,
      }));
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const selectedFiles = inputs
    .map((path) => formatSelectionLabel(path))
    .slice(0, 4);

  const currentModelAllowsSpeed = currentModel?.supportsSpeed ?? false;
  const showSpeakerPicker = currentModel?.supportsSpeakerWav ?? false;

  return (
    <div className="shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="hero">
        <div>
          <p className="eyebrow">Audiobook TTS Workbench</p>
          <h1>Converta novelas e textos com fluxo rápido, visual e local.</h1>
          <p className="hero-copy">
            Selecione uma pasta ou arquivos, escolha o modelo, ajuste vozes e
            acompanhe o progresso em tempo real sem sair do desktop.
          </p>
        </div>

        <div className="hero-card">
          <span className="hero-card-label">Estado atual</span>
          <strong>{job.status}</strong>
          <p>{job.message}</p>
          <div className="mini-progress">
            <span style={{ width: `${Math.max(totalProgress, 0) * 100}%` }} />
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="stack">
          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Entrada</p>
                <h2>Arquivos ou pasta</h2>
              </div>
              <span className="panel-note">{selectedPreview}</span>
            </div>

            <div className="action-row">
              <button className="primary-button" onClick={chooseFiles}>
                Escolher arquivos
              </button>
              <button className="secondary-button" onClick={chooseFolder}>
                Escolher pasta
              </button>
            </div>

            <div className="selection-list">
              {selectedFiles.length ? (
                selectedFiles.map((item) => (
                  <span className="selection-chip" key={item}>
                    {item}
                  </span>
                ))
              ) : (
                <p className="muted">
                  Escolha um arquivo Markdown ou uma pasta com vários arquivos.
                </p>
              )}
              {inputs.length > 4 ? (
                <span className="selection-chip muted-chip">
                  +{inputs.length - 4} itens
                </span>
              ) : null}
            </div>

            <div className="preview-block">
              <div className="preview-metric">
                <strong>{previewLoading ? "..." : inputPreview?.file_count ?? inputs.length}</strong>
                <span>arquivos Markdown detectados</span>
              </div>
              <div className="preview-copy">
                <p>
                  {inputPreview
                    ? inputPreview.kind === "directory"
                      ? "A pasta selecionada foi escaneada pelo backend."
                      : "Arquivo carregado para conversão."
                    : "Nenhum preview carregado ainda."}
                </p>
                {visibleFiles.length ? (
                  <ul>
                    {visibleFiles.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Saída</p>
                <h2>Onde salvar</h2>
              </div>
              <span className="panel-note">
                {outputDir ? formatSelectionLabel(outputDir) : "Nenhuma pasta definida"}
              </span>
            </div>

            <div className="action-row">
              <button className="primary-button" onClick={chooseOutputDir}>
                Escolher pasta de saída
              </button>
              <button className="secondary-button" onClick={resetForm}>
                Limpar tudo
              </button>
            </div>

            <div className="field">
              <label htmlFor="output-dir">Destino selecionado</label>
              <input id="output-dir" value={outputDir} readOnly placeholder="Selecione a pasta de saída" />
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Modelo</p>
                <h2>Motor TTS</h2>
              </div>
              <span className="panel-note">
                {loadingCatalog ? "Carregando..." : `${catalog?.models.length ?? 0} disponíveis`}
              </span>
            </div>

            <div className="model-grid">
              {catalog?.models
                .slice()
                .sort((left, right) => {
                  const leftIndex = modelOrder.indexOf(left.id);
                  const rightIndex = modelOrder.indexOf(right.id);
                  return leftIndex - rightIndex;
                })
                .map((item) => (
                  <button
                    className={`model-card ${model === item.id ? "model-card-selected" : ""}`}
                    key={item.id}
                    onClick={() => setModel(item.id)}
                  >
                    <div className="model-card-top">
                      <strong>{item.name}</strong>
                      <span>{item.offline ? "offline" : "online"}</span>
                    </div>
                    <p>{item.description}</p>
                    <div className="model-tags">
                      <span>{item.accent}</span>
                      <span>{item.supportsSpeakerWav ? "referência WAV" : "voz pronta"}</span>
                      <span>{item.supportsSpeed ? "ajuste de velocidade" : "velocidade fixa"}</span>
                    </div>
                  </button>
                ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Voz</p>
                <h2>Seleção e filtro</h2>
              </div>
              <span className="panel-note">
                {currentModel?.id === "xtts"
                  ? "XTTS usa WAV de referência"
                  : "Filtre por nome ou código"}
              </span>
            </div>

            {currentModel?.id === "xtts" ? (
              <div className="reference-box">
                <div className="field">
                  <label htmlFor="speaker-wav">Arquivo WAV de referência</label>
                  <input
                    id="speaker-wav"
                    value={speakerWav}
                    onChange={(event) => setSpeakerWav(event.target.value)}
                    placeholder="Escolha o arquivo WAV de referência"
                  />
                </div>
                <button className="secondary-button" onClick={chooseSpeakerWav}>
                  Escolher WAV
                </button>
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="voice-filter">Filtro</label>
                  <input
                    id="voice-filter"
                    value={voiceFilter}
                    onChange={(event) => setVoiceFilter(event.target.value)}
                    placeholder="Buscar voz..."
                  />
                </div>

                <div className="voice-list">
                  {availableVoices.map((voice) => (
                    <button
                      className={`voice-chip ${selectedVoice === voice.id ? "voice-chip-selected" : ""}`}
                      key={voice.id}
                      onClick={() => setSelectedVoice(voice.id)}
                    >
                      <strong>{voice.label}</strong>
                      <span>{voice.id}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {showSpeakerPicker ? (
              <p className="muted voice-note">
                XTTS usa voz de referência e não lista vozes pré-definidas.
              </p>
            ) : null}
          </article>

          <details className="panel advanced-panel">
            <summary>
              <div>
                <p className="panel-kicker">Avançado</p>
                <h2>Parâmetros de execução</h2>
              </div>
              <span className="panel-note">Opcional</span>
            </summary>

            <div className="advanced-grid">
              <div className="field">
                <label htmlFor="start-at">Start at</label>
                <input
                  id="start-at"
                  type="number"
                  min={1}
                  value={startAt}
                  onChange={(event) => setStartAt(Number(event.target.value) || 1)}
                />
                <small>Arquivo inicial na pasta ou chunk inicial no arquivo único.</small>
              </div>

              <div className="field">
                <label htmlFor="workers">Workers</label>
                <input
                  id="workers"
                  type="number"
                  min={1}
                  value={maxWorkers}
                  onChange={(event) => setMaxWorkers(Number(event.target.value) || 1)}
                />
                <small>Controle de paralelismo por chunk.</small>
              </div>

              <div className="field">
                <label htmlFor="speed">Velocidade</label>
                <input
                  id="speed"
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                  disabled={!currentModelAllowsSpeed}
                />
                <small>{currentModelAllowsSpeed ? `${speed.toFixed(1)}x` : "Fixo neste modelo"}</small>
              </div>
            </div>
          </details>

          <div className="footer-actions">
            <button className="launch-button" onClick={startConversion} disabled={busy}>
              {busy ? "Processando..." : "Iniciar conversão"}
            </button>
            <div className="status-pill">
              <span />
              <strong>{inputs.length} entrada(s)</strong>
              <strong>{outputDir ? "saída pronta" : "sem saída"}</strong>
            </div>
          </div>

          {error ? <div className="error-box">{error}</div> : null}
        </section>

        <aside className="sidebar">
          <article className="panel progress-panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Progresso</p>
                <h2>Execução atual</h2>
              </div>
              <span className="panel-note">{formatPercent(totalProgress)}</span>
            </div>

            <div className="progress-visual">
              <div className="progress-ring">
                <span style={{ "--progress": totalProgress } as CSSProperties} />
                <strong>{formatPercent(totalProgress)}</strong>
              </div>
              <div className="progress-copy">
                <p>{job.message}</p>
                <dl>
                  <div>
                    <dt>Arquivo</dt>
                    <dd>
                      {job.current_file_name
                        ? `${job.current_file_index}/${job.total_files} · ${job.current_file_name}`
                        : "Aguardando entrada"}
                    </dd>
                  </div>
                  <div>
                    <dt>Chunk</dt>
                    <dd>
                      {job.total_chunks
                        ? `${job.completed_chunks}/${job.total_chunks}`
                        : "Sem chunks ainda"}
                    </dd>
                  </div>
                  <div>
                    <dt>Saída</dt>
                    <dd>{outputDir || "Escolha uma pasta"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </article>

          <article className="panel log-panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Log</p>
                <h2>Eventos recentes</h2>
              </div>
              <span className="panel-note">{logs.length} linhas</span>
            </div>

            <div className="log-list">
              {logs.length ? (
                logs
                  .slice(-12)
                  .reverse()
                  .map((line, index) => (
                    <p key={`${index}-${line}`}>{line}</p>
                  ))
              ) : (
                <p className="muted">Os eventos aparecerão aqui quando a conversão começar.</p>
              )}
            </div>
          </article>
        </aside>
      </main>
    </div>
  );
}

export default App;
