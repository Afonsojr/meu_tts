import { useEffect, useMemo, useRef, useState } from "react";
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

type FileStatus = {
  path: string;
  name: string;
  index: number;
  status: string;
  message: string;
  error: string | null;
  output_path: string | null;
  completed_chunks: number;
  total_chunks: number;
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
      files: FileStatus[];
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
  files: FileStatus[];
};

type SourceMode = "file" | "files" | "directory";
type OutputFormat = "mp3" | "wav" | "ogg";
type NavView = "converter" | "agrupar";

type GroupProgressEvent = {
  group_index: number;
  total_groups: number;
  total_files: number;
  output_file: string | null;
  status: string;
  message: string;
};

const defaultModelId = "edge";
const modelOrder = ["edge", "kokoro", "piper", "edge-xtts", "xtts"];

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
  files: [],
};

function formatSelectionLabel(path: string) {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function formatSeconds(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function voiceInitials(label: string): string {
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function WaveStrip({ n = 80, seed = 1 }: { n?: number; seed?: number }) {
  const bars = useMemo(() => {
    let s = seed * 9301;
    const rnd = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: n }, (_, i) => ({
      h: 6 + Math.abs(Math.sin(i * 0.35 + seed) * 20) + rnd() * 10,
    }));
  }, [n, seed]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "2px", height: "32px", overflow: "hidden", flex: 1 }}>
      {bars.map((b, i) => (
        <i
          key={i}
          style={{
            display: "block",
            width: "2px",
            height: `${b.h}px`,
            background: "linear-gradient(180deg, var(--daw-teal), var(--daw-teal-dim))",
            borderRadius: "1px",
            opacity: 0.55,
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}

function AgruparView() {
  const [sourceFolder, setSourceFolder] = useState<string>(
    () => localStorage.getItem("agrupar_src") || "",
  );
  const [outputDir, setOutputDir] = useState<string>(
    () => localStorage.getItem("agrupar_out") || "",
  );
  const [groupSize, setGroupSize] = useState<3 | 5 | 10>(5);
  const [audioFiles, setAudioFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<GroupProgressEvent | null>(null);
  const [completedFiles, setCompletedFiles] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!sourceFolder) {
      setAudioFiles([]);
      return;
    }
    setLoadingFiles(true);
    invoke<string[]>("list_audio_folder", { path: sourceFolder })
      .then((files) => {
        setAudioFiles(files);
        setLoadingFiles(false);
      })
      .catch((e) => {
        setError(String(e));
        setAudioFiles([]);
        setLoadingFiles(false);
      });
  }, [sourceFolder]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<GroupProgressEvent>("group-audio-event", (event) => {
      const p = event.payload;
      setLastEvent(p);
      if (p.status === "group_done" && p.output_file) {
        setCompletedFiles((prev) => [...prev, p.output_file!]);
      }
      if (p.status === "done") {
        setBusy(false);
        setDone(true);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const groups = useMemo(() => {
    const result: string[][] = [];
    for (let i = 0; i < audioFiles.length; i += groupSize) {
      result.push(audioFiles.slice(i, i + groupSize));
    }
    return result;
  }, [audioFiles, groupSize]);

  async function chooseSourceFolder() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return;
      setSourceFolder(picked);
      localStorage.setItem("agrupar_src", picked);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseOutputDir() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return;
      setOutputDir(picked);
      localStorage.setItem("agrupar_out", picked);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function reset() {
    setLastEvent(null);
    setCompletedFiles([]);
    setDone(false);
    setError(null);
  }

  async function startGrouping() {
    if (!sourceFolder || !outputDir || busy) return;
    setBusy(true);
    reset();
    try {
      await invoke("group_audio", {
        request: { folder: sourceFolder, output_dir: outputDir, group_size: groupSize },
      });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const canStart = !busy && !!sourceFolder && !!outputDir && audioFiles.length > 0;
  const groupProgress =
    lastEvent && lastEvent.total_groups > 0
      ? lastEvent.group_index / lastEvent.total_groups
      : 0;

  const statusText = busy
    ? (lastEvent?.message ?? "Processando...")
    : done
      ? `${completedFiles.length} grupos criados com sucesso`
      : canStart
        ? `${audioFiles.length} arquivos → ${groups.length} grupos de ${groupSize}`
        : sourceFolder
          ? loadingFiles
            ? "Lendo pasta..."
            : audioFiles.length === 0
              ? "Nenhum arquivo de áudio encontrado"
              : "Pronto"
          : "Selecione uma pasta de origem";

  return (
    <div style={{ display: "grid", gap: "var(--daw-gap)", padding: "0 0 40px" }}>
      {/* Config panel */}
      <section className="daw-panel">
        <header className="daw-panel-head">
          <span className="daw-panel-tag">Agrupar</span>
          <h3>Mesclar arquivos de áudio</h3>
          <span className="daw-panel-sub" />
          <span className="daw-chip muted" style={{ cursor: "default" }}>
            {audioFiles.length > 0 ? `${audioFiles.length} arquivos` : "sem arquivos"}
          </span>
        </header>
        <div className="daw-panel-body">
          <div className="daw-rack">
            {/* Left col: folders */}
            <div className="daw-col">
              <div>
                <span className="daw-row-label">Pasta de origem</span>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: "var(--daw-row-h)",
                      background: "var(--daw-bg-0)",
                      border: "1px solid var(--daw-line)",
                      borderRadius: "8px",
                      padding: "0 12px",
                      display: "flex",
                      alignItems: "center",
                      fontFamily: "var(--daw-font-mono)",
                      fontSize: "11px",
                      color: sourceFolder ? "var(--daw-ink-1)" : "var(--daw-ink-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sourceFolder || "Nenhuma pasta selecionada"}
                  </div>
                  <button className="daw-mini-btn" onClick={chooseSourceFolder}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    Escolher
                  </button>
                </div>
                <div style={{ marginTop: "6px", fontFamily: "var(--daw-font-mono)", fontSize: "10.5px", color: "var(--daw-ink-3)" }}>
                  {loadingFiles ? "lendo..." : audioFiles.length > 0 ? `${audioFiles.length} arquivo${audioFiles.length !== 1 ? "s" : ""} de áudio (.mp3 / .ogg / .wav)` : sourceFolder ? "nenhum arquivo de áudio encontrado" : ""}
                </div>
              </div>

              <div className="daw-hr" />

              <div>
                <span className="daw-row-label">Pasta de saída</span>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: "var(--daw-row-h)",
                      background: "var(--daw-bg-0)",
                      border: "1px solid var(--daw-line)",
                      borderRadius: "8px",
                      padding: "0 12px",
                      display: "flex",
                      alignItems: "center",
                      fontFamily: "var(--daw-font-mono)",
                      fontSize: "11px",
                      color: outputDir ? "var(--daw-ink-1)" : "var(--daw-ink-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {outputDir || "Nenhuma pasta selecionada"}
                  </div>
                  <button className="daw-mini-btn" onClick={chooseOutputDir}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    Escolher
                  </button>
                </div>
              </div>
            </div>

            {/* Right col: group size */}
            <div className="daw-col">
              <div>
                <span className="daw-row-label">Tamanho do grupo</span>
                <p className="daw-row-help" style={{ marginBottom: "12px" }}>
                  Quantos arquivos serão mesclados em cada grupo. Os arquivos são ordenados por nome antes de agrupar.
                </p>
                <div className="daw-seg" style={{ width: "fit-content" }}>
                  {([3, 5, 10] as const).map((n) => (
                    <button
                      key={n}
                      className={groupSize === n ? "on" : ""}
                      onClick={() => setGroupSize(n)}
                    >
                      {n} arquivos
                    </button>
                  ))}
                </div>
                {audioFiles.length > 0 && (
                  <div style={{ marginTop: "16px", display: "grid", gap: "8px" }}>
                    <div style={{ fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-ink-2)" }}>
                      {audioFiles.length} arquivos →{" "}
                      <span style={{ color: "var(--daw-amber)" }}>{groups.length} grupo{groups.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {groups.map((g, i) => (
                        <span key={i} className="daw-chip muted" style={{ cursor: "default" }}>
                          G{i + 1}: {g.length} arq
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Preview panel */}
      {audioFiles.length > 0 && (
        <section className="daw-panel">
          <header className="daw-panel-head">
            <span className="daw-panel-tag">Prévia</span>
            <h3>Divisão dos grupos</h3>
            <span className="daw-panel-sub" />
            <span className="daw-chip teal" style={{ cursor: "default" }}>
              {groups.length} grupos · {groupSize} por grupo
            </span>
          </header>
          <div className="daw-panel-body">
            <div style={{ maxHeight: "260px", overflowY: "auto", display: "grid", gap: "8px" }}>
              {groups.map((group, gi) => (
                <div
                  key={gi}
                  style={{
                    background: "var(--daw-bg-0)",
                    border: "1px solid var(--daw-line-soft)",
                    borderRadius: "8px",
                    padding: "10px 14px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-amber)", fontWeight: 600 }}>
                      Grupo {gi + 1}
                    </span>
                    <span style={{ fontFamily: "var(--daw-font-mono)", fontSize: "10.5px", color: "var(--daw-ink-3)" }}>
                      · {group.length} arquivo{group.length !== 1 ? "s" : ""}
                    </span>
                    {completedFiles.length > gi && (
                      <span style={{ marginLeft: "auto", fontFamily: "var(--daw-font-mono)", fontSize: "10.5px", color: "var(--daw-teal)" }}>
                        ✓ {formatSelectionLabel(completedFiles[gi])}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {group.map((fname, fi) => (
                      <span
                        key={fi}
                        style={{
                          fontFamily: "var(--daw-font-mono)",
                          fontSize: "10.5px",
                          color: "var(--daw-ink-2)",
                          background: "var(--daw-bg-2)",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          border: "1px solid var(--daw-line)",
                        }}
                      >
                        {fname}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Error */}
      {error && (
        <div className="daw-error">
          ⚠ {error}
          <button
            onClick={() => setError(null)}
            style={{
              float: "right",
              background: "transparent",
              border: "none",
              color: "var(--daw-red)",
              cursor: "pointer",
              fontSize: "12px",
              padding: 0,
              fontFamily: "var(--daw-font-mono)",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Transport bar */}
      <div className="daw-transport">
        <div className="daw-status-pill">
          <span className={`daw-status-dot ${busy ? "running" : done ? "completed" : ""}`} />
          {statusText}
        </div>
        <WaveStrip n={120} seed={42} />
        <div className="daw-transport-actions">
          <button className="daw-btn" onClick={reset} disabled={busy}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9" /><path d="M3 3v6h6" />
            </svg>
            Redefinir
          </button>
          <button className="daw-btn primary" onClick={startGrouping} disabled={!canStart}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
            </svg>
            {busy ? "Mesclando..." : "Agrupar"}
          </button>
        </div>
      </div>

      {/* Progress panel */}
      {(busy || done) && lastEvent && (
        <section className="daw-panel">
          <header className="daw-panel-head">
            <span className="daw-panel-tag">Execução</span>
            <h3>Mesclagem de grupos</h3>
            <span className="daw-panel-sub" />
            {done ? (
              <span className="daw-chip teal" style={{ cursor: "default" }}>
                ✓ {completedFiles.length} grupos criados
              </span>
            ) : (
              <span className="daw-chip amber" style={{ cursor: "default" }}>
                ● {lastEvent.group_index}/{lastEvent.total_groups}
              </span>
            )}
          </header>
          <div className="daw-panel-body" style={{ display: "grid", gap: "14px" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span className="daw-section-label">Progresso geral</span>
                <span style={{ fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-ink-2)" }}>
                  {lastEvent.group_index}/{lastEvent.total_groups} grupos
                </span>
              </div>
              <div className="daw-bar">
                <span
                  className={`daw-bar-fill ${busy ? "active" : ""}`}
                  style={{ width: `${Math.round(groupProgress * 100)}%` }}
                />
              </div>
              <div style={{ marginTop: "8px", fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-ink-2)" }}>
                {lastEvent.message}
              </div>
            </div>

            {completedFiles.length > 0 && (
              <div>
                <span className="daw-section-label" style={{ marginBottom: "8px", display: "block" }}>
                  Arquivos criados
                </span>
                <div style={{ display: "grid", gap: "4px" }}>
                  {completedFiles.map((f, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 10px",
                        background: "var(--daw-bg-0)",
                        borderRadius: "6px",
                        border: "1px solid var(--daw-line-soft)",
                      }}
                    >
                      <span style={{ color: "var(--daw-teal)", fontSize: "12px" }}>✓</span>
                      <span
                        style={{
                          fontFamily: "var(--daw-font-mono)",
                          fontSize: "11px",
                          color: "var(--daw-ink-1)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatSelectionLabel(f)}
                      </span>
                      <span style={{ fontFamily: "var(--daw-font-mono)", fontSize: "10px", color: "var(--daw-ink-3)" }}>
                        grupo {i + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function App() {
  const [navView, setNavView] = useState<NavView>("converter");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [job, setJob] = useState<JobState>(defaultJobState);
  const [logs, setLogs] = useState<string[]>([]);
  const [sourceMode, setSourceMode] = useState<SourceMode>("file");
  const [inputs, setInputs] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState<string>("");
  const [speakerWav, setSpeakerWav] = useState<string>("");
  const [model, setModel] = useState(defaultModelId);
  const [voiceFilter, setVoiceFilter] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [speed, setSpeed] = useState(0);
  const [startAt, setStartAt] = useState(1);
  const [maxWorkers, setMaxWorkers] = useState(10);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp3");
  const [inputPreview, setInputPreview] = useState<InputPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalJobTime, setFinalJobTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [density, setDensity] = useState<"comfortable" | "compact">(
    () => (localStorage.getItem("dawDensity") as "comfortable" | "compact") ?? "comfortable",
  );
  const [tweakOpen, setTweakOpen] = useState(false);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [lastInputDir, setLastInputDir] = useState<string>(
    () => localStorage.getItem("lastInputDir") || "",
  );
  const [lastOutputDir, setLastOutputDir] = useState<string>(
    () => localStorage.getItem("lastOutputDir") || "",
  );
  const jobStartTimeRef = useRef<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Load catalog
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    invoke<Catalog>("get_catalog")
      .then((data) => {
        setCatalog(data);
        setBridgeOnline(true);
        const fallbackModelId = data.defaultModel || defaultModelId;
        setModel(fallbackModelId);
        const defaultModel = data.models.find((m) => m.id === fallbackModelId);
        setSelectedVoice(defaultModel?.defaultVoice ?? defaultModel?.voices[0]?.id ?? null);
      })
      .catch((err) => {
        setBridgeOnline(false);
        setError(err instanceof Error ? err.message : String(err));
      });

    listen<ConversionEvent>("tts-event", (event) => {
      const payload = event.payload;

      if (payload.kind === "log") {
        setLogs((current) => [...current.slice(-199), payload.message]);
        return;
      }

      const { kind: _kind, ...statusPayload } = payload;
      setJob((current) => ({ ...current, ...statusPayload }));

      if (payload.status === "completed") {
        setBusy(false);
        const startTime = jobStartTimeRef.current;
        if (startTime && startTime > 0) {
          setFinalJobTime(Math.round((Date.now() - startTime) / 1000));
        }
        jobStartTimeRef.current = null;
      }

      if (payload.status === "running" && !jobStartTimeRef.current) {
        jobStartTimeRef.current = Date.now();
      }

      if (payload.status === "error") {
        setBusy(false);
        jobStartTimeRef.current = null;
        setError(payload.error ?? payload.message);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Elapsed timer
  useEffect(() => {
    if (job.status !== "running") {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      const startTime = jobStartTimeRef.current;
      if (startTime) setElapsedSeconds(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [job.status]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Voice validation
  useEffect(() => {
    const currentModel = catalog?.models.find((m) => m.id === model);
    if (!currentModel) return;
    if (currentModel.id === "xtts") { setSelectedVoice(null); return; }
    const voiceStillValid = currentModel.voices.some((v) => v.id === selectedVoice);
    if (!voiceStillValid) {
      setSelectedVoice(currentModel.defaultVoice ?? currentModel.voices[0]?.id ?? null);
    }
  }, [catalog, model, selectedVoice]);

  // Input preview
  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!inputs.length) { setInputPreview(null); return; }

      if (sourceMode === "files" && inputs.length > 1) {
        setInputPreview({
          path: inputs[0],
          kind: "directory",
          file_count: inputs.length,
          files: inputs.map((p) => formatSelectionLabel(p)),
        });
        return;
      }

      setPreviewLoading(true);
      try {
        const preview = await invoke<InputPreview>("inspect_input", { path: inputs[0] });
        if (!cancelled) setInputPreview(preview);
      } catch (err) {
        if (!cancelled) { setInputPreview(null); setError(err instanceof Error ? err.message : String(err)); }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }

    void loadPreview();
    return () => { cancelled = true; };
  }, [inputs, sourceMode]);

  const currentModel = catalog?.models.find((m) => m.id === model) ?? null;

  const modelOptions = useMemo(() => {
    if (!catalog) return [];
    return catalog.models.slice().sort((a, b) => modelOrder.indexOf(a.id) - modelOrder.indexOf(b.id));
  }, [catalog]);

  const availableVoices = useMemo(() => {
    if (!currentModel) return [];
    const query = voiceFilter.trim().toLowerCase();
    return currentModel.voices.filter((v) =>
      !query || v.id.toLowerCase().includes(query) || v.label.toLowerCase().includes(query),
    );
  }, [currentModel, voiceFilter]);

  const totalProgress =
    job.total_chunks > 0 ? job.completed_chunks / job.total_chunks : job.progress;

  const currentModelAllowsSpeed = currentModel?.supportsSpeed ?? false;
  const showSpeakerPicker = currentModel?.supportsSpeakerWav ?? false;
  const activeVoiceLabel = showSpeakerPicker
    ? speakerWav
      ? formatSelectionLabel(speakerWav)
      : "WAV de referência"
    : selectedVoice ?? "voz automática";
  const outputLabel = outputDir ? formatSelectionLabel(outputDir) : "—";

  const canStart =
    !busy &&
    inputs.length > 0 &&
    outputDir.length > 0 &&
    (!showSpeakerPicker || speakerWav.length > 0);

  const validationHints = [
    inputs.length > 0 ? null : "Escolha um arquivo ou pasta.",
    outputDir ? null : "Defina a pasta de saída.",
    showSpeakerPicker && !speakerWav ? "XTTS exige um WAV de referência." : null,
  ].filter(Boolean) as string[];

  // Derived session info
  const sessionTitle = inputs.length
    ? formatSelectionLabel(inputs[0])
    : "Nova sessão";

  const sessionSubtitle = previewLoading
    ? "lendo..."
    : inputPreview
      ? inputPreview.kind === "directory"
        ? `${inputPreview.file_count} arquivos`
        : "arquivo único pronto"
      : "sem entrada";

  // Queue items
  const queueItems = useMemo(() => {
    if (job.files.length > 0) {
      return job.files.map((f) => ({
        state:
          f.status === "completed"
            ? "done"
            : f.status === "running" || f.status === "retrying"
              ? "active"
              : f.status === "error"
                ? "err"
                : "queued",
        name: f.name,
        chunks:
          f.total_chunks > 0
            ? `${f.completed_chunks}/${f.total_chunks}`
            : "—",
        path: f.path,
        canRetry: f.status === "error" && !busy,
      }));
    }
    if (inputPreview && sourceMode !== "file") {
      return inputPreview.files.map((name) => ({
        state: "queued",
        name,
        chunks: "—",
        path: name,
        canRetry: false,
      }));
    }
    return [];
  }, [job.files, inputPreview, sourceMode, busy]);

  const completedCount = job.files.filter((f) => f.status === "completed").length;
  const activeCount = job.files.filter(
    (f) => f.status === "running" || f.status === "retrying",
  ).length;
  const queuedCount = job.files.filter((f) => f.status === "queued").length;

  // Timing display
  const elapsedDisplay =
    job.status === "completed" && finalJobTime !== null
      ? formatSeconds(finalJobTime)
      : job.status === "running"
        ? formatSeconds(elapsedSeconds)
        : "—";

  async function retryFile(filePath: string) {
    if (!job.job_id || busy) return;
    try {
      setBusy(true);
      setError(null);
      await invoke("retry_file_conversion", {
        request: { job_id: job.job_id, file_path: filePath },
      });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function chooseFiles() {
    try {
      const picked = await open({
        multiple: true,
        directory: false,
        defaultPath: lastInputDir || undefined,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });
      if (!picked) return;
      const normalized = Array.isArray(picked) ? picked : [picked];
      setInputs(normalized);
      setSourceMode(normalized.length > 1 ? "files" : "file");
      if (normalized.length > 0) {
        const firstPath = normalized[0];
        const lastSep = Math.max(firstPath.lastIndexOf("/"), firstPath.lastIndexOf("\\"));
        if (lastSep > 0) {
          const dirPath = firstPath.substring(0, lastSep);
          setLastInputDir(dirPath);
          localStorage.setItem("lastInputDir", dirPath);
        }
      }
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
        defaultPath: lastInputDir || undefined,
      });
      if (!picked || Array.isArray(picked)) return;
      setInputs([picked]);
      setSourceMode("directory");
      setLastInputDir(picked);
      localStorage.setItem("lastInputDir", picked);
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
        defaultPath: lastOutputDir || undefined,
      });
      if (!picked || Array.isArray(picked)) return;
      setOutputDir(picked);
      setLastOutputDir(picked);
      localStorage.setItem("lastOutputDir", picked);
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
        filters: [{ name: "WAV", extensions: ["wav"] }],
      });
      if (!picked || Array.isArray(picked)) return;
      setSpeakerWav(picked);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function resetForm() {
    setInputs([]);
    setSourceMode("file");
    setOutputDir("");
    setSpeakerWav("");
    const fallbackModelId = catalog?.defaultModel ?? defaultModelId;
    setModel(fallbackModelId);
    const fallbackModel = catalog?.models.find((m) => m.id === fallbackModelId);
    setSelectedVoice(fallbackModel?.defaultVoice ?? fallbackModel?.voices[0]?.id ?? null);
    setVoiceFilter("");
    setSpeed(0);
    setStartAt(1);
    setMaxWorkers(10);
    setJob(defaultJobState);
    setLogs([]);
    setInputPreview(null);
    setFinalJobTime(null);
    jobStartTimeRef.current = null;
    setError(null);
  }

  async function startConversion() {
    if (!inputs.length) { setError("Escolha um arquivo ou uma pasta de entrada."); return; }
    if (!outputDir) { setError("Escolha a pasta de saída."); return; }
    if (currentModel?.supportsSpeakerWav && !speakerWav) {
      setError("O modelo selecionado requer um arquivo WAV de referência.");
      return;
    }

    const request: ConversionRequest = {
      inputs,
      output_dir: outputDir,
      model,
      voice: currentModel?.supportsSpeakerWav ? null : selectedVoice,
      speed: 1.0 + speed / 100,
      speaker_wav: currentModel?.supportsSpeakerWav ? speakerWav || null : null,
      start_at: startAt,
      max_workers: Number.isFinite(maxWorkers) && maxWorkers > 0 ? maxWorkers : null,
    };

    try {
      const startTime = Date.now();
      setBusy(true);
      setError(null);
      setLogs([]);
      jobStartTimeRef.current = startTime;
      setFinalJobTime(null);
      setJob({
        ...defaultJobState,
        status: "queued",
        message: "Fila preparada. Iniciando conversão...",
        progress: 0,
      });

      const response = await invoke<{ job_id: string }>("start_conversion", { request });
      setJob((current) => ({ ...current, job_id: response.job_id }));
    } catch (err) {
      setBusy(false);
      jobStartTimeRef.current = null;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelConversion() {
    if (!job.job_id) return;
    try {
      await invoke("cancel_conversion", { jobId: job.job_id });
      setBusy(false);
      setJob((current) => ({
        ...current,
        status: "cancelled",
        message: "Conversão cancelada pelo usuário.",
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="daw-shell" data-density={density}>
      <div className="daw-window">
        {/* ===== Titlebar ===== */}
        <div className="daw-titlebar">
          <div className="daw-tb-dots">
            <span className="daw-tb-dot r" />
            <span className="daw-tb-dot y" />
            <span className="daw-tb-dot g" />
          </div>
          <div className="daw-tb-center">
            <span className="daw-tb-rec" />
            <span>
              Audiobook Studio ·{" "}
              {bridgeOnline ? "bridge online" : "bridge offline"}
            </span>
          </div>
          <div className="daw-tb-right">
            <span>v0.9 · {currentModel?.id ?? "edge-tts"}</span>
            <button className="daw-tweaks-btn" onClick={() => setTweakOpen((o) => !o)}>
              Tweaks
            </button>
          </div>
        </div>

        <div className="daw-app">
          {/* ===== Sidebar ===== */}
          <aside className="daw-sidebar">
            <div className="daw-brand">
              <div className="daw-brand-mark">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(0.82 0.14 78)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12h2" /><path d="M8 8v8" /><path d="M12 5v14" /><path d="M16 9v6" /><path d="M19 12h2" />
                </svg>
              </div>
              <div>
                <div className="daw-brand-name">Audiobook Studio</div>
                <div className="daw-brand-ver">tts workbench · v0.9</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div className="daw-nav-label">Sessão</div>
              <div
                className={`daw-nav-item ${navView === "converter" ? "active" : ""}`}
                onClick={() => setNavView("converter")}
              >
                <svg className="daw-nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12h2" /><path d="M8 8v8" /><path d="M12 5v14" /><path d="M16 9v6" /><path d="M19 12h2" />
                </svg>
                Converter
                <span className="daw-nav-kbd">⌘1</span>
              </div>
              <div
                className={`daw-nav-item ${navView === "agrupar" ? "active" : ""}`}
                onClick={() => setNavView("agrupar")}
              >
                <svg className="daw-nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
                </svg>
                Agrupar
                <span className="daw-nav-kbd">⌘2</span>
              </div>
              <div className="daw-nav-item">
                <svg className="daw-nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Preferências
              </div>
            </div>

            <div className="daw-sidebar-footer">
              <div className="daw-sys-card">
                <div className="daw-sys-row">
                  <span>bridge</span>
                  <span
                    className="daw-sys-v"
                    style={{ color: bridgeOnline ? "var(--daw-teal)" : "var(--daw-red)" }}
                  >
                    ● {bridgeOnline ? "online" : "offline"}
                  </span>
                </div>
                <div className="daw-sys-row">
                  <span>modelo</span>
                  <span className="daw-sys-v">{currentModel?.id ?? "—"}</span>
                </div>
                <div className="daw-sys-row">
                  <span>workers</span>
                  <span className="daw-sys-v">{maxWorkers}</span>
                </div>
                <div className="daw-sys-row">
                  <span>status</span>
                  <span
                    className="daw-sys-v"
                    style={{
                      color:
                        job.status === "running"
                          ? "var(--daw-amber)"
                          : job.status === "completed"
                            ? "var(--daw-green)"
                            : job.status === "error"
                              ? "var(--daw-red)"
                              : "var(--daw-ink-2)",
                    }}
                  >
                    {job.status}
                  </span>
                </div>
              </div>
            </div>
          </aside>

          {/* ===== Main ===== */}
          <main className="daw-main">
            {navView === "agrupar" ? (
              <AgruparView />
            ) : (<>
            {/* Session bar */}
            <section className="daw-session">
              <div className="daw-sess-cell title">
                <div className="k">Sessão atual</div>
                <div className="v" title={inputs[0] ?? ""}>{sessionTitle}</div>
                <div className="sub">{sessionSubtitle}</div>
              </div>
              <div className="daw-sess-cell">
                <div className="k">Entrada</div>
                <div className="v">
                  {sourceMode === "file"
                    ? "1 arquivo .md"
                    : sourceMode === "files"
                      ? `${inputs.length} arquivos`
                      : "pasta"}
                </div>
              </div>
              <div className="daw-sess-cell">
                <div className="k">Modelo</div>
                <div className="v">{currentModel?.name ?? "—"}</div>
              </div>
              <div className="daw-sess-cell">
                <div className="k">Saída</div>
                <div className="v">{outputFormat.toUpperCase()} · 192k</div>
              </div>
              <div className="daw-sess-cell clock">
                <div className="k">
                  {job.status === "running" ? "Decorrido" : "Tempo total"}
                </div>
                <div className="v">{elapsedDisplay}</div>
              </div>
            </section>

            {/* Config panel */}
            <section className="daw-panel">
              <header className="daw-panel-head">
                <span className="daw-panel-tag">Configuração</span>
                <h3>Modelo, voz, entrada e saída</h3>
                <span className="daw-panel-sub" />
                {validationHints.length === 0 ? (
                  <span className="daw-chip teal" style={{ cursor: "default" }}>
                    {inputs.length ? "pronto" : "aguardando"}
                  </span>
                ) : (
                  <span className="daw-chip" style={{ color: "var(--daw-yellow)", borderColor: "oklch(0.62 0.12 78 / 0.4)", cursor: "default" }}>
                    {validationHints.length} pendente{validationHints.length > 1 ? "s" : ""}
                  </span>
                )}
              </header>
              <div className="daw-panel-body">
                <div className="daw-rack">
                  {/* Left col: Model + Voice */}
                  <div className="daw-col">
                    <div>
                      <span className="daw-row-label">Modelo ativo</span>
                      <div className="daw-model-select">
                        <span className="daw-led" />
                        <span style={{ color: "var(--daw-ink-0)", fontWeight: 500 }}>
                          {currentModel?.name ?? "—"}
                        </span>
                        <span style={{ color: "var(--daw-ink-3)", fontFamily: "var(--daw-font-mono)", fontSize: "11px" }}>
                          · {currentModel?.offline ? "offline" : "online"}
                        </span>
                      </div>
                      <div className="daw-chips">
                        {modelOptions.map((m) => (
                          <span
                            key={m.id}
                            className={`daw-chip ${model === m.id ? "amber" : ""}`}
                            onClick={() => setModel(m.id)}
                          >
                            {m.name.toLowerCase()}
                          </span>
                        ))}
                      </div>
                      <p className="daw-row-help">{currentModel?.description ?? "Selecione um modelo."}</p>
                    </div>

                    <div className="daw-hr" />

                    {showSpeakerPicker ? (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                          <span className="daw-row-label" style={{ margin: 0 }}>WAV de referência</span>
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <div
                            style={{
                              flex: 1,
                              height: "var(--daw-row-h)",
                              background: "var(--daw-bg-0)",
                              border: "1px solid var(--daw-line)",
                              borderRadius: "8px",
                              padding: "0 12px",
                              display: "flex",
                              alignItems: "center",
                              fontFamily: "var(--daw-font-mono)",
                              fontSize: "11px",
                              color: "var(--daw-ink-2)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {speakerWav ? formatSelectionLabel(speakerWav) : "Nenhum WAV selecionado"}
                          </div>
                          <button className="daw-mini-btn" onClick={chooseSpeakerWav}>
                            Escolher WAV
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                          <span className="daw-row-label" style={{ margin: 0 }}>Voz</span>
                          <span className="daw-spacer" />
                          <span className="daw-chip muted">{availableVoices.length} opções</span>
                        </div>
                        <div className="daw-voice-search">
                          <svg
                            className="daw-voice-search-ico"
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.3-4.3" />
                          </svg>
                          <input
                            className="daw-voice-input"
                            type="text"
                            placeholder="Buscar por nome ou código"
                            value={voiceFilter}
                            onChange={(e) => setVoiceFilter(e.target.value)}
                          />
                        </div>
                        <div className="daw-voice-grid">
                          {availableVoices.map((voice) => (
                            <div
                              key={voice.id}
                              className={`daw-voice ${selectedVoice === voice.id ? "selected" : ""}`}
                              onClick={() => setSelectedVoice(voice.id)}
                            >
                              <div className="daw-voice-avatar">
                                {voiceInitials(voice.label)}
                              </div>
                              <div className="daw-voice-meta">
                                <div className="daw-voice-name">{voice.label}</div>
                                <div className="daw-voice-code">{voice.id}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* Voice preview strip */}
                        <div
                          style={{
                            marginTop: "14px",
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            background: "var(--daw-bg-0)",
                            border: "1px solid var(--daw-line-soft)",
                            borderRadius: "10px",
                            padding: "10px 12px",
                          }}
                        >
                          <div style={{ fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-ink-2)", whiteSpace: "nowrap" }}>
                            {activeVoiceLabel}
                          </div>
                          <WaveStrip n={90} seed={3} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right col: Source + IO */}
                  <div className="daw-col">
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                        <span className="daw-row-label" style={{ margin: 0 }}>Fonte do texto</span>
                        <span className="daw-spacer" />
                        <span className="daw-chip teal">
                          {sourceMode === "file" ? "arquivo único .md" : sourceMode === "files" ? "múltiplos" : "pasta"}
                        </span>
                      </div>
                      <div className="daw-tabs">
                        <div
                          className={`daw-tab ${sourceMode === "file" ? "active" : ""}`}
                          onClick={() => setSourceMode("file")}
                        >
                          <div className="daw-tt">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <path d="M14 2v6h6" />
                            </svg>
                            Arquivo
                          </div>
                          <div className="daw-dd">um .md → um mp3</div>
                        </div>
                        <div
                          className={`daw-tab ${sourceMode === "files" ? "active" : ""}`}
                          onClick={() => setSourceMode("files")}
                        >
                          <div className="daw-tt">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                              <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                            </svg>
                            Lote
                          </div>
                          <div className="daw-dd">vários · capítulos</div>
                        </div>
                        <div
                          className={`daw-tab ${sourceMode === "directory" ? "active" : ""}`}
                          onClick={() => setSourceMode("directory")}
                        >
                          <div className="daw-tt">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                            Pasta
                          </div>
                          <div className="daw-dd">varrer recursivamente</div>
                        </div>
                      </div>
                    </div>

                    {/* File preview */}
                    <div
                      style={{
                        border: "1px solid var(--daw-line-soft)",
                        borderRadius: "10px",
                        background: "var(--daw-bg-0)",
                        padding: "14px",
                      }}
                    >
                      {inputs.length > 0 ? (
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                          <div
                            style={{
                              width: "40px",
                              height: "48px",
                              borderRadius: "6px",
                              background: "linear-gradient(180deg, var(--daw-bg-3), var(--daw-bg-2))",
                              border: "1px solid var(--daw-line)",
                              display: "grid",
                              placeItems: "center",
                              fontFamily: "var(--daw-font-mono)",
                              fontSize: "9px",
                              color: "var(--daw-ink-2)",
                              flexShrink: 0,
                            }}
                          >
                            {sourceMode === "directory" ? "DIR" : "MD"}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: "var(--daw-font-mono)", fontSize: "12px", color: "var(--daw-ink-0)" }}>
                              {formatSelectionLabel(inputs[0])}
                            </div>
                            <div
                              style={{
                                fontFamily: "var(--daw-font-mono)",
                                fontSize: "10.5px",
                                color: "var(--daw-ink-3)",
                                marginTop: "2px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {inputs[0]}
                            </div>
                            <div
                              style={{
                                marginTop: "8px",
                                display: "flex",
                                gap: "10px",
                                fontFamily: "var(--daw-font-mono)",
                                fontSize: "10.5px",
                                color: "var(--daw-ink-2)",
                              }}
                            >
                              {previewLoading ? (
                                <span>carregando...</span>
                              ) : inputPreview ? (
                                <>
                                  <span>· {inputPreview.file_count} {inputPreview.kind === "directory" ? "arquivos" : "capítulo(s)"}</span>
                                  {inputs.length > 1 && <span>· {inputs.length} selecionados</span>}
                                </>
                              ) : (
                                <span>· pronto</span>
                              )}
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <button
                              className="daw-mini-btn"
                              onClick={sourceMode === "directory" ? chooseFolder : chooseFiles}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
                              </svg>
                              Trocar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ textAlign: "center", padding: "16px 0" }}>
                          <button
                            className="daw-mini-btn"
                            style={{ margin: "0 auto" }}
                            onClick={sourceMode === "directory" ? chooseFolder : chooseFiles}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
                            </svg>
                            {sourceMode === "directory" ? "Selecionar pasta" : "Selecionar arquivo(s) .md"}
                          </button>
                          <div style={{ marginTop: "8px", fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-ink-3)" }}>
                            Nenhuma entrada selecionada
                          </div>
                        </div>
                      )}
                    </div>

                    {/* IO metadata grid */}
                    <div>
                      <span className="daw-row-label">Saída e destino</span>
                      <div className="daw-io-grid">
                        <div className="daw-io-cell">
                          <div className="k">Pasta de saída</div>
                          <div className="v mono">{outputDir || "não definida"}</div>
                        </div>
                        <div className="daw-io-cell">
                          <div className="k">Formato</div>
                          <div className="v">{outputFormat.toUpperCase()} · 192k</div>
                        </div>
                        <div className="daw-io-cell">
                          <div className="k">Voz selecionada</div>
                          <div className="v mono">{activeVoiceLabel}</div>
                        </div>
                        <div className="daw-io-cell">
                          <div className="k">Workers</div>
                          <div className="v">{maxWorkers}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                        <button className="daw-mini-btn" onClick={chooseOutputDir}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          Pasta de saída
                        </button>
                        <button className="daw-mini-btn ghost" onClick={resetForm}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12a9 9 0 1 0 9-9" /><path d="M3 3v6h6" />
                          </svg>
                          Redefinir
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Error display */}
            {error && (
              <div className="daw-error">
                ⚠ {error}
                <button
                  onClick={() => setError(null)}
                  style={{
                    float: "right",
                    background: "transparent",
                    border: "none",
                    color: "var(--daw-red)",
                    cursor: "pointer",
                    fontSize: "12px",
                    padding: 0,
                    fontFamily: "var(--daw-font-mono)",
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Transport bar */}
            <div className="daw-transport">
              <div className="daw-status-pill">
                <span
                  className={`daw-status-dot ${
                    job.status === "running"
                      ? "running"
                      : job.status === "completed"
                        ? "completed"
                        : job.status === "error"
                          ? "error"
                          : ""
                  }`}
                />
                {job.status === "running"
                  ? job.current_file_name
                    ? `Convertendo ${job.current_file_name}`
                    : "Processando..."
                  : job.status === "completed"
                    ? "Conversão concluída"
                    : job.status === "error"
                      ? "Erro na conversão"
                      : job.status === "queued"
                        ? "Na fila..."
                        : validationHints.length
                          ? validationHints[0]
                          : "Pronto para converter"}
                {job.status === "running" && job.total_chunks > 0 && (
                  <span style={{ fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-ink-3)", marginLeft: "8px" }}>
                    · {job.completed_chunks}/{job.total_chunks} chunks
                  </span>
                )}
              </div>
              <WaveStrip n={120} seed={7} />
              <div className="daw-transport-actions">
                {busy ? (
                  <button className="daw-btn danger" onClick={cancelConversion}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" />
                    </svg>
                    Parar
                  </button>
                ) : (
                  <button className="daw-btn" onClick={resetForm}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9" /><path d="M3 3v6h6" />
                    </svg>
                    Redefinir
                  </button>
                )}
                <button
                  className="daw-btn primary"
                  onClick={startConversion}
                  disabled={!canStart}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {busy ? "Processando..." : "Iniciar conversão"}
                </button>
              </div>
            </div>

            {/* Execution panel */}
            <section className="daw-panel">
              <header className="daw-panel-head">
                <span className="daw-panel-tag">Execução</span>
                <h3>Estado atual</h3>
                <span className="daw-panel-sub" />
                {job.status === "running" && (
                  <span
                    className="daw-chip amber"
                    style={{ cursor: "default" }}
                  >
                    ● {Math.round(totalProgress * 100)}% · {elapsedDisplay}
                  </span>
                )}
                {job.status === "completed" && (
                  <span className="daw-chip teal" style={{ cursor: "default" }}>
                    ✓ concluído · {elapsedDisplay}
                  </span>
                )}
              </header>
              <div className="daw-panel-body" style={{ display: "grid", gap: "14px" }}>

                {/* Overall progress */}
                <div className="daw-progress-overall">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                      <span className="daw-section-label">Progresso geral</span>
                      <span style={{ flex: 1 }} />
                      {job.total_chunks > 0 && (
                        <span style={{ fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-ink-2)" }}>
                          chunk {job.completed_chunks} / {job.total_chunks}
                        </span>
                      )}
                    </div>
                    <div className="daw-bar">
                      <span
                        className={`daw-bar-fill ${job.status === "running" ? "active" : ""}`}
                        style={{ width: `${Math.round(totalProgress * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontFamily: "var(--daw-font-mono)",
                        fontSize: "24px",
                        color: "var(--daw-amber)",
                        letterSpacing: "-0.02em",
                        textShadow: "0 0 10px oklch(0.82 0.14 78 / 0.25)",
                      }}
                    >
                      {elapsedDisplay}
                    </div>
                    <div style={{ fontFamily: "var(--daw-font-mono)", fontSize: "10.5px", color: "var(--daw-ink-3)" }}>
                      {job.status === "running" ? "decorrido" : job.status === "completed" ? "tempo final" : "em espera"}
                    </div>
                  </div>
                </div>

                {/* VU meters */}
                <div className="daw-meter-stack">
                  <div className="daw-meter">
                    <div className="k">Arquivo</div>
                    <div className={`v ${job.current_file_index > 0 ? "" : ""}`}>
                      {job.total_files > 0 ? `${job.current_file_index}/${job.total_files}` : "—"}
                    </div>
                    <div className="sub">
                      {job.current_file_name ? formatSelectionLabel(job.current_file_name) : "aguardando"}
                    </div>
                  </div>
                  <div className="daw-meter">
                    <div className="k">Chunk atual</div>
                    <div className="v amber">
                      {job.total_chunks > 0 ? job.completed_chunks : "—"}
                    </div>
                    <div className="sub">
                      {job.total_chunks > 0 ? `de ${job.total_chunks}` : "sem chunks"}
                    </div>
                  </div>
                  <div className="daw-meter">
                    <div className="k">Progresso</div>
                    <div className="v">{Math.round(totalProgress * 100)}%</div>
                    <div className="sub">
                      {job.status === "running" ? "em andamento" : job.status}
                    </div>
                  </div>
                  <div className="daw-meter">
                    <div className="k">Saída</div>
                    <div className="v" style={{ fontSize: "15px", paddingTop: "4px" }}>
                      {outputFormat.toUpperCase()} · 192k
                    </div>
                    <div className="sub">{outputDir ? outputLabel : "sem destino"}</div>
                  </div>
                </div>

                {/* Chapter queue */}
                {queueItems.length > 0 && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "6px 0 6px" }}>
                      <span className="daw-section-label">Fila de capítulos</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontFamily: "var(--daw-font-mono)", fontSize: "10.5px", color: "var(--daw-ink-2)" }}>
                        {completedCount > 0 && `${completedCount} concluídos · `}
                        {activeCount > 0 && `${activeCount} ativo · `}
                        {queuedCount > 0 && `${queuedCount} em fila`}
                      </span>
                    </div>
                    <div className="daw-queue">
                      {queueItems.map((item, idx) => (
                        <div key={`${item.path}-${idx}`} className={`daw-queue-item ${item.state}`}>
                          <span className="daw-q-state" />
                          <span className="daw-q-name">{item.name}</span>
                          <span className="daw-q-chunks">{item.chunks}</span>
                          <span className="daw-q-dur">
                            {item.canRetry ? (
                              <button
                                className="daw-retry-btn"
                                onClick={() => retryFile(item.path)}
                              >
                                retry
                              </button>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Log */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "10px 0 6px" }}>
                    <span className="daw-section-label">Log da bridge</span>
                    <span style={{ flex: 1 }} />
                    <button
                      className="daw-mini-btn ghost"
                      style={{ height: "26px", fontSize: "11px" }}
                      onClick={() => setLogs([])}
                    >
                      Limpar
                    </button>
                  </div>
                  <div className="daw-log">
                    {logs.length ? (
                      logs.slice(-30).map((line, i) => {
                        const isOk = line.toLowerCase().includes("ok") || line.toLowerCase().includes("escrito") || line.toLowerCase().includes("concluído");
                        const isWarn = line.toLowerCase().includes("warn") || line.toLowerCase().includes("retry");
                        const isErr = line.toLowerCase().includes("error") || line.toLowerCase().includes("erro");
                        return (
                          <div key={i}>
                            <span className={isOk ? "lok" : isWarn ? "lwarn" : isErr ? "lerr" : ""}>
                              {line}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ color: "var(--daw-ink-3)", fontSize: "11px" }}>
                        Os eventos da bridge aparecem aqui quando a conversão começar.
                      </div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>

                {/* Advanced settings */}
                <details className="daw-adv">
                  <summary>
                    <span className="daw-chev">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </span>
                    Ajustes avançados
                    <span style={{ flex: 1 }} />
                    <span style={{ color: "var(--daw-ink-3)", textTransform: "none", letterSpacing: 0, fontSize: "11px" }}>
                      start · workers · formato · velocidade
                    </span>
                  </summary>
                  <div className="daw-adv-body">
                    <div className="daw-field">
                      <label>Start at · capítulo inicial</label>
                      <div className="daw-num">
                        <input
                          type="number"
                          min={1}
                          value={startAt}
                          onChange={(e) => setStartAt(Number(e.target.value) || 1)}
                        />
                        <div className="daw-num-bumps">
                          <button onClick={() => setStartAt((v) => v + 1)}>▲</button>
                          <button onClick={() => setStartAt((v) => Math.max(1, v - 1))}>▼</button>
                        </div>
                      </div>
                      <div className="hint">Chunk inicial no arquivo único ou capítulo inicial na pasta.</div>
                    </div>
                    <div className="daw-field">
                      <label>Workers · paralelismo</label>
                      <div className="daw-num">
                        <input
                          type="number"
                          min={1}
                          max={32}
                          value={maxWorkers}
                          onChange={(e) => setMaxWorkers(Number(e.target.value) || 1)}
                        />
                        <div className="daw-num-bumps">
                          <button onClick={() => setMaxWorkers((v) => Math.min(32, v + 1))}>▲</button>
                          <button onClick={() => setMaxWorkers((v) => Math.max(1, v - 1))}>▼</button>
                        </div>
                      </div>
                      <div className="hint">Paralelismo por chunk. Edge TTS: 8–12 recomendado.</div>
                    </div>
                    <div className="daw-field">
                      <label>Formato de saída</label>
                      <div className="daw-seg">
                        {(["mp3", "wav", "ogg"] as OutputFormat[]).map((fmt) => (
                          <button
                            key={fmt}
                            className={outputFormat === fmt ? "on" : ""}
                            onClick={() => setOutputFormat(fmt)}
                          >
                            {fmt.toUpperCase()}
                          </button>
                        ))}
                      </div>
                      <div className="hint">Bitrate e sample rate configuráveis por modelo.</div>
                    </div>
                    <div className="daw-field">
                      <label>Velocidade de fala</label>
                      <div className="daw-slider">
                        <span style={{ fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-ink-3)" }}>
                          lento
                        </span>
                        <input
                          type="range"
                          className="daw-range"
                          min={-50}
                          max={50}
                          step={5}
                          value={speed}
                          onChange={(e) => setSpeed(Number(e.target.value))}
                          disabled={!currentModelAllowsSpeed}
                        />
                        <span style={{ fontFamily: "var(--daw-font-mono)", fontSize: "11px", color: "var(--daw-ink-3)" }}>
                          rápido
                        </span>
                      </div>
                      <div className="hint">
                        {currentModelAllowsSpeed
                          ? `${speed > 0 ? "+" : ""}${speed}% · Edge TTS: –50% a +50%.`
                          : "Este modelo não expõe velocidade ajustável."}
                      </div>
                    </div>
                  </div>
                </details>

              </div>
            </section>
            </>)}
          </main>
        </div>

        {/* Footer */}
        <div className="daw-foot">
          <div className="daw-foot-hints">
            <span><kbd>⌘↵</kbd> iniciar</span>
            <span><kbd>Space</kbd> pausar</span>
            <span><kbd>⌘R</kbd> redefinir</span>
            <span><kbd>⌘,</kbd> preferências</span>
          </div>
          <div>bridge · {bridgeOnline ? "online" : "offline"} · {currentModel?.id ?? "—"}</div>
        </div>
      </div>

      {/* Tweak panel */}
      {tweakOpen && (
        <div className="daw-tweak-panel">
          <h4>Tweaks</h4>
          <div className="daw-tweak-row">
            <span>Densidade</span>
            <select
              value={density}
              onChange={(e) => {
                const v = e.target.value as "comfortable" | "compact";
                setDensity(v);
                localStorage.setItem("dawDensity", v);
              }}
            >
              <option value="comfortable">Confortável</option>
              <option value="compact">Compacto</option>
            </select>
          </div>
          <div
            style={{
              color: "var(--daw-ink-3)",
              fontSize: "11px",
              marginTop: "8px",
              lineHeight: 1.45,
            }}
          >
            A densidade afeta espaçamento, altura de rows e tamanhos de texto.
          </div>
          <button
            className="daw-mini-btn"
            style={{ marginTop: "10px", width: "100%", justifyContent: "center" }}
            onClick={() => setTweakOpen(false)}
          >
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
