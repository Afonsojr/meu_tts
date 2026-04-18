import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Files,
  FileText,
  FolderOpen,
  Gauge,
  LoaderCircle,
  Play,
  RefreshCcw,
  Search,
  Settings2,
  Sparkles,
  Volume2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

type StartResponse = {
  job_id: string;
  status: string;
  message: string;
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

const defaultModelId = "edge";
const modelOrder = ["edge", "kokoro", "piper", "edge-xtts", "xtts"];

const sourceModeOptions: Array<{
  id: SourceMode;
  label: string;
  description: string;
  actionLabel: string;
  icon: typeof FileText;
}> = [
  {
    id: "file",
    label: "Arquivo",
    description: "Texto isolado para MP3",
    actionLabel: "Selecionar arquivo",
    icon: FileText,
  },
  {
    id: "files",
    label: "Multiplos",
    description: "Capitulos em sequencia",
    actionLabel: "Selecionar arquivos",
    icon: Files,
  },
  {
    id: "directory",
    label: "Pasta",
    description: "Escanear diretorio inteiro",
    actionLabel: "Selecionar pasta",
    icon: FolderOpen,
  },
];

const defaultJobState: JobState = {
  job_id: "",
  status: "idle",
  message: "Escolha a entrada e configure a saida para comecar.",
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

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatSelectionLabel(path: string) {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function formatSeconds(value: number | null) {
  if (value === null) {
    return "—";
  }

  if (value < 60) {
    return `${value}s`;
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function statusBadgeClass(status: string) {
  if (status === "error") {
    return "border-destructive/30 bg-destructive/15 text-destructive-foreground";
  }

  if (status === "completed") {
    return "border-[rgb(110_142_106_/0.28)] bg-[rgb(95_133_84_/0.12)] text-[rgb(202_224_190)]";
  }

  if (status === "completed_with_errors") {
    return "border-[rgb(166_121_83_/0.34)] bg-[rgb(166_121_83_/0.12)] text-[rgb(246_223_196)]";
  }

  if (status === "running") {
    return "border-[rgb(207_171_128_/0.28)] bg-[rgb(179_137_96_/0.12)] text-[rgb(240_221_200)]";
  }

  return "border-border bg-background/70 text-muted-foreground";
}

function App() {
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
  const [speed, setSpeed] = useState(1);
  const [startAt, setStartAt] = useState(1);
  const [maxWorkers, setMaxWorkers] = useState(2);
  const [inputPreview, setInputPreview] = useState<InputPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lastInputDir, setLastInputDir] = useState<string>(() => localStorage.getItem("lastInputDir") || "");
  const [lastOutputDir, setLastOutputDir] = useState<string>(() => localStorage.getItem("lastOutputDir") || "");
  const [finalJobTime, setFinalJobTime] = useState<number | null>(null);
  const jobStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    invoke<Catalog>("get_catalog")
      .then((data) => {
        setCatalog(data);
        const fallbackModelId = data.defaultModel || defaultModelId;
        setModel(fallbackModelId);
        const defaultModel = data.models.find((item) => item.id === fallbackModelId);
        setSelectedVoice(defaultModel?.defaultVoice ?? defaultModel?.voices[0]?.id ?? null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });

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
      if (!inputs.length) {
        setInputPreview(null);
        return;
      }

      if (sourceMode === "files" && inputs.length > 1) {
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
  }, [inputs, sourceMode]);

  const currentModel = catalog?.models.find((item) => item.id === model) ?? null;

  const modelOptions = useMemo(() => {
    if (!catalog) {
      return [];
    }

    return catalog.models
      .slice()
      .sort((left, right) => modelOrder.indexOf(left.id) - modelOrder.indexOf(right.id));
  }, [catalog]);

  const availableVoices = useMemo(() => {
    if (!currentModel) {
      return [];
    }

    const query = voiceFilter.trim().toLowerCase();
    return currentModel.voices.filter((voice) => {
      if (!query) {
        return true;
      }

      return voice.id.toLowerCase().includes(query) || voice.label.toLowerCase().includes(query);
    });
  }, [currentModel, voiceFilter]);

  const selectedPreview = useMemo(() => {
    if (!inputs.length) {
      return "Nenhuma entrada selecionada";
    }

    if (sourceMode === "directory") {
      return `${formatSelectionLabel(inputs[0])} · pasta`;
    }

    if (sourceMode === "file") {
      return `${formatSelectionLabel(inputs[0])} · arquivo`;
    }

    return `${inputs.length} arquivos selecionados`;
  }, [inputs, sourceMode]);

  const totalProgress = job.total_chunks > 0 ? job.completed_chunks / job.total_chunks : job.progress;
  const sourceModeConfig =
    sourceModeOptions.find((item) => item.id === sourceMode) ?? sourceModeOptions[0];
  const currentModelAllowsSpeed = currentModel?.supportsSpeed ?? false;
  const currentModelAllowsSpeakerWav = currentModel?.supportsSpeakerWav ?? false;
  const showSpeakerPicker = currentModelAllowsSpeakerWav;
  const activeVoiceLabel = showSpeakerPicker
    ? speakerWav
      ? formatSelectionLabel(speakerWav)
      : "WAV de referencia"
    : selectedVoice ?? "voz automatica";
  const outputLabel = outputDir ? formatSelectionLabel(outputDir) : "sem saida";
  const selectedFiles = inputs.map((path) => formatSelectionLabel(path)).slice(0, 5);
  const recentLogs = logs.slice(-4).reverse();
  const jobFiles = job.files;
  const convertedFiles = jobFiles.filter((file) => file.status === "completed").length;
  const failedFiles = jobFiles.filter((file) => file.status === "error").length;
  const pendingFiles = jobFiles.filter((file) =>
    ["queued", "running", "retrying", "merging"].includes(file.status),
  ).length;
  const canStart =
    !busy &&
    inputs.length > 0 &&
    outputDir.length > 0 &&
    (!showSpeakerPicker || speakerWav.length > 0);
  const validationHints = [
    inputs.length > 0 ? null : "Escolha um arquivo ou uma pasta.",
    outputDir ? null : "Defina a pasta de saida.",
    showSpeakerPicker && !speakerWav ? "XTTS exige um WAV de referencia." : null,
  ].filter(Boolean) as string[];
  const statusLabel =
    job.status === "completed"
      ? "Pronto"
      : job.status === "running"
        ? "Em gravacao"
        : job.status === "completed_with_errors"
          ? "Concluido com falhas"
        : job.status === "error"
          ? "Erro"
          : job.status === "queued"
            ? "Na fila"
            : "Em espera";
  const timerLabel =
    job.status === "completed"
      ? formatSeconds(finalJobTime)
      : job.status === "running"
        ? "capturando"
        : "—";
  const setupSummary = previewLoading
    ? "Lendo a origem selecionada..."
    : inputPreview
      ? inputPreview.kind === "directory"
        ? `${inputPreview.file_count} capitulos prontos para lote`
        : "Arquivo unico pronto para conversao"
      : "Selecione a origem do texto e a pasta de saida";
  const readinessCopy = validationHints.length
    ? `${validationHints.length} ajuste${validationHints.length > 1 ? "s" : ""} pendente${validationHints.length > 1 ? "s" : ""}`
    : "Sessao pronta para iniciar";
  const fileProgressLabel = job.current_file_name
    ? `${job.current_file_index}/${job.total_files} · ${job.current_file_name}`
    : "Nenhum arquivo em processamento";
  const chunkProgressLabel = job.total_chunks
    ? `${job.completed_chunks}/${job.total_chunks} chunks fechados`
    : "Chunks ainda nao iniciados";
  const voicePanelKicker = showSpeakerPicker ? "Clonagem por referencia" : "Catalogo de vozes";
  const modelDescriptor = currentModel?.description ?? "Modelo pronto para uso de estudio.";

  async function retryFile(filePath: string) {
    if (!job.job_id || busy) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      await invoke<StartResponse>("retry_file_conversion", {
        request: {
          job_id: job.job_id,
          file_path: filePath,
        },
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

      if (!picked || Array.isArray(picked)) {
        return;
      }

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

      if (!picked || Array.isArray(picked)) {
        return;
      }

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
    setSourceMode("file");
    setOutputDir("");
    setSpeakerWav("");
    const fallbackModelId = catalog?.defaultModel ?? defaultModelId;
    setModel(fallbackModelId);
    const fallbackModel = catalog?.models.find((item) => item.id === fallbackModelId);
    setSelectedVoice(fallbackModel?.defaultVoice ?? fallbackModel?.voices[0]?.id ?? null);
    setVoiceFilter("");
    setSpeed(1);
    setStartAt(1);
    setMaxWorkers(2);
    setJob(defaultJobState);
    setLogs([]);
    setInputPreview(null);
    setFinalJobTime(null);
    jobStartTimeRef.current = null;
    setError(null);
  }

  async function startConversion() {
    if (!inputs.length) {
      setError("Escolha um arquivo ou uma pasta de entrada.");
      return;
    }

    if (!outputDir) {
      setError("Escolha a pasta de saida.");
      return;
    }

    if (currentModel?.supportsSpeakerWav && !speakerWav) {
      setError("O modelo selecionado requer um arquivo WAV de referencia.");
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
      const startTime = Date.now();
      setBusy(true);
      setError(null);
      setLogs([]);
      jobStartTimeRef.current = startTime;
      setFinalJobTime(null);
      setJob({
        ...defaultJobState,
        status: "queued",
        message: "Fila preparada. Iniciando conversao...",
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
      jobStartTimeRef.current = null;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_0%,rgb(171_126_90_/0.18),transparent_28%),radial-gradient(circle_at_86%_12%,rgb(111_133_154_/0.18),transparent_24%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255_/0.02),transparent_38%,rgb(255_255_255_/0.03))]" />
      <div className="pointer-events-none absolute inset-x-0 top-24 h-px bg-[linear-gradient(90deg,transparent,rgb(255_255_255_/0.24),transparent)]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1720px] flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6 xl:px-10 xl:py-8">
        <header className="grid gap-4 xl:grid-cols-[1.2fr_0.9fr]">
          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(135deg,rgb(33_28_25_/0.96),rgb(20_22_28_/0.92))]">
            <CardContent className="grid gap-8 p-6 xl:grid-cols-[1.2fr_0.8fr] xl:p-8">
              <div className="grid gap-6">
                <div className="flex items-center gap-4">
                  <div className="grid size-14 place-items-center rounded-[1.35rem] border border-white/20 bg-[linear-gradient(135deg,rgb(195_154_114_/0.95),rgb(240_226_204_/0.86))] text-[rgb(41_30_20)] shadow-[0_18px_45px_rgb(0_0_0_/0.26)]">
                    <Sparkles className="size-5" />
                  </div>
                  <div>
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-[rgb(206_190_173_/0.72)]">
                      TTS Studio Desk
                    </p>
                    <h1 className="mt-2 font-['Fraunces'] text-[clamp(2rem,4vw,3.45rem)] leading-[0.95] tracking-[-0.03em] text-[rgb(247_240_231)]">
                      Lote de audio com leitura de estacao.
                    </h1>
                  </div>
                </div>

                <p className="max-w-2xl text-sm leading-7 text-[rgb(213_203_190_/0.84)] sm:text-[0.97rem]">
                  Interface pensada para produtor solo: preparar entrada, fixar voz e disparar a
                  sessao sem se perder em painel tecnico. A execucao fica visivel o tempo todo e a
                  preparacao ocupa o centro da pagina.
                </p>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] px-4 py-4">
                    <p className="text-[0.68rem] uppercase tracking-[0.22em] text-[rgb(206_190_173_/0.64)]">
                      Entrada
                    </p>
                    <p className="mt-2 text-sm font-medium text-[rgb(248_242_236)]">
                      {sourceModeConfig.label}
                    </p>
                  </div>
                  <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] px-4 py-4">
                    <p className="text-[0.68rem] uppercase tracking-[0.22em] text-[rgb(206_190_173_/0.64)]">
                      Modelo
                    </p>
                    <p className="mt-2 text-sm font-medium text-[rgb(248_242_236)]">
                      {currentModel?.name ?? model}
                    </p>
                  </div>
                  <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] px-4 py-4">
                    <p className="text-[0.68rem] uppercase tracking-[0.22em] text-[rgb(206_190_173_/0.64)]">
                      Sessao
                    </p>
                    <p className="mt-2 text-sm font-medium text-[rgb(248_242_236)]">{readinessCopy}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 self-start xl:border-l xl:border-white/10 xl:pl-6">
                <div className="rounded-[1.8rem] border border-white/10 bg-[rgb(255_255_255_/0.04)] p-5">
                  <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[rgb(206_190_173_/0.66)]">
                    Sala de controle
                  </p>
                  <div className="mt-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-3xl font-semibold tracking-[-0.04em] text-[rgb(248_242_236)]">
                        {timerLabel}
                      </p>
                      <p className="mt-2 text-sm text-[rgb(214_204_191_/0.78)]">
                        {job.status === "completed"
                          ? "Tempo final da ultima rodada."
                          : job.status === "running"
                            ? "Cronometro armado para a sessao atual."
                            : "Nenhuma captura em andamento."}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em]",
                        statusBadgeClass(job.status),
                      )}
                    >
                      {statusLabel}
                    </Badge>
                  </div>
                </div>

                <div className="rounded-[1.8rem] border border-[rgb(205_164_126_/0.24)] bg-[linear-gradient(180deg,rgb(198_158_120_/0.12),rgb(255_255_255_/0.02))] p-5">
                  <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[rgb(216_198_178_/0.7)]">
                    Mesa pronta
                  </p>
                  <p className="mt-3 text-sm leading-7 text-[rgb(242_233_222_/0.9)]">{setupSummary}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[rgb(216_198_178_/0.62)]">
                    {outputDir ? `Saida em ${outputLabel}` : "Sem pasta de saida definida"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[linear-gradient(180deg,rgb(24_27_34_/0.92),rgb(18_18_24_/0.96))]">
            <CardContent className="grid gap-5 p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
                    Execucao
                  </p>
                  <h2 className="mt-2 font-['Fraunces'] text-3xl tracking-[-0.03em] text-foreground">
                    Estado vivo
                  </h2>
                </div>
                {busy ? (
                  <Badge variant="secondary" className="gap-1 rounded-full px-3 py-1 text-[0.68rem] uppercase tracking-[0.16em]">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    processando
                  </Badge>
                ) : null}
              </div>

              <div className="rounded-[1.8rem] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{job.message}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {statusLabel}
                    </p>
                  </div>
                  <strong className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
                    {formatPercent(totalProgress)}
                  </strong>
                </div>
                <Progress className="mt-4 h-2.5 bg-white/8" value={Math.round(totalProgress * 100)} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                    Arquivo atual
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground">{fileProgressLabel}</p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                    Progresso do lote
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground">{chunkProgressLabel}</p>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                  Faixa recente
                </p>
                <div className="mt-3 grid gap-2">
                  {recentLogs.length ? (
                    recentLogs.map((line, index) => (
                      <p
                        key={`${index}-${line}`}
                        className="rounded-2xl border border-white/8 bg-black/10 px-3 py-2 text-sm leading-6 text-[rgb(228_220_209_/0.84)]"
                      >
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm leading-6 text-muted-foreground">
                      Os eventos mais recentes do bridge aparecerao aqui quando a conversao
                      comecar.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </header>

        <main className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgb(249_246_240_/0.985),rgb(237_231_221_/0.94))] text-[rgb(42_35_29)] shadow-[0_30px_90px_rgb(0_0_0_/0.2)]">
            <CardHeader className="gap-4 border-b border-[rgb(66_49_33_/0.1)] px-6 py-6 xl:px-8 xl:py-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-[rgb(110_91_74_/0.72)]">
                    Preparacao
                  </p>
                  <CardTitle className="mt-2 font-['Fraunces'] text-[clamp(2rem,3.5vw,3rem)] font-semibold leading-[0.96] tracking-[-0.04em] text-[rgb(43_33_24)]">
                    Configure a mesa antes de rodar o lote.
                  </CardTitle>
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full border-[rgb(80_61_42_/0.18)] bg-[rgb(255_255_255_/0.55)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.16em] text-[rgb(73_57_43)]"
                >
                  {catalog ? `${modelOptions.length}/${catalog.models.length} modelos` : "catalogo"}
                </Badge>
              </div>
              <CardDescription className="max-w-3xl text-[0.97rem] leading-7 text-[rgb(94_77_60_/0.84)]">
                O setup fica em sequencia operacional: origem do texto, destino, modelo e voz.
                Nada aqui concorre com o painel de execucao.
              </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-8 px-6 py-6 xl:px-8 xl:py-8">
              <section className="grid gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[rgb(110_91_74_/0.7)]">
                      Fonte do texto
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[rgb(45_33_24)]">
                      Entrada e saida em uma unica faixa
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className="rounded-full border-[rgb(91_70_49_/0.16)] bg-[rgb(255_255_255_/0.46)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.16em] text-[rgb(73_57_43)]"
                  >
                    {sourceModeConfig.label}
                  </Badge>
                </div>

                <Tabs value={sourceMode} onValueChange={(value) => setSourceMode(value as SourceMode)}>
                  <TabsList className="grid h-auto w-full grid-cols-3 rounded-[1.5rem] bg-[rgb(67_50_33_/0.07)] p-1.5">
                    {sourceModeOptions.map((item) => {
                      const Icon = item.icon;
                      return (
                        <TabsTrigger
                          key={item.id}
                          value={item.id}
                          className="flex h-auto flex-col items-start gap-1 rounded-[1.15rem] px-4 py-4 text-left data-[state=active]:bg-[rgb(255_255_255_/0.82)] data-[state=active]:shadow-[0_10px_26px_rgb(0_0_0_/0.06)]"
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold text-[rgb(48_37_28)]">
                            <Icon className="size-4 text-[rgb(163_111_72)]" />
                            {item.label}
                          </span>
                          <span className="text-xs leading-5 text-[rgb(106_89_72)]">
                            {item.description}
                          </span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>

                <div className="grid gap-4 rounded-[2rem] border border-[rgb(70_54_36_/0.12)] bg-[rgb(255_255_255_/0.38)] p-5">
                  <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                    <div className="grid gap-2">
                      <Label htmlFor="input-preview" className="text-[rgb(58_43_30)]">
                        Entrada atual
                      </Label>
                      <Input
                        id="input-preview"
                        value={selectedPreview}
                        readOnly
                        placeholder="Nenhuma entrada selecionada"
                        className="h-12 rounded-[1.1rem] border-[rgb(82_64_46_/0.14)] bg-[rgb(255_255_255_/0.65)] px-4 text-[rgb(47_35_25)] placeholder:text-[rgb(119_100_82)]"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="output-dir" className="text-[rgb(58_43_30)]">
                        Pasta de saida
                      </Label>
                      <Input
                        id="output-dir"
                        value={outputDir}
                        readOnly
                        placeholder="Selecione a pasta de saida"
                        className="h-12 rounded-[1.1rem] border-[rgb(82_64_46_/0.14)] bg-[rgb(255_255_255_/0.65)] px-4 text-[rgb(47_35_25)] placeholder:text-[rgb(119_100_82)]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={sourceMode === "directory" ? chooseFolder : chooseFiles}
                      className="min-w-44 rounded-full px-5"
                    >
                      {sourceModeConfig.actionLabel}
                    </Button>
                    <Button variant="outline" onClick={chooseOutputDir} className="rounded-full px-5">
                      <FolderOpen className="size-4" />
                      Escolher saida
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={resetForm}
                      className="rounded-full px-5 text-[rgb(88_67_49)] hover:bg-[rgb(83_62_43_/0.08)] hover:text-[rgb(49_37_27)]"
                    >
                      <RefreshCcw className="size-4" />
                      Limpar sessao
                    </Button>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-[1.5rem] border border-[rgb(82_64_46_/0.12)] bg-[rgb(255_255_255_/0.55)] p-4">
                      <p className="text-[0.68rem] uppercase tracking-[0.2em] text-[rgb(110_91_74_/0.72)]">
                        Leitura rapida
                      </p>
                      <p className="mt-3 text-sm leading-7 text-[rgb(74_58_42)]">{setupSummary}</p>
                    </div>

                    <div className="rounded-[1.5rem] border border-[rgb(82_64_46_/0.12)] bg-[rgb(255_255_255_/0.55)] p-4">
                      <p className="text-[0.68rem] uppercase tracking-[0.2em] text-[rgb(110_91_74_/0.72)]">
                        Arquivos visiveis
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(selectedFiles.length ? selectedFiles : ["Nenhum arquivo"]).map((label) => (
                          <span
                            key={label}
                            className="rounded-full border border-[rgb(88_68_48_/0.14)] bg-[rgb(255_255_255_/0.72)] px-3 py-1 text-xs font-medium text-[rgb(79_60_43)]"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[rgb(110_91_74_/0.7)]">
                      Voz e motor
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[rgb(45_33_24)]">
                      Escolha o timbre antes de gravar
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className="rounded-full border-[rgb(91_70_49_/0.16)] bg-[rgb(255_255_255_/0.5)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.16em] text-[rgb(73_57_43)]"
                    >
                      {voicePanelKicker}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="rounded-full border-[rgb(91_70_49_/0.16)] bg-[rgb(255_255_255_/0.5)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.16em] text-[rgb(73_57_43)]"
                    >
                      {activeVoiceLabel}
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                  <div className="grid gap-4 rounded-[2rem] border border-[rgb(70_54_36_/0.12)] bg-[rgb(255_255_255_/0.38)] p-5">
                    <div className="grid gap-2">
                      <Label htmlFor="model-select" className="text-[rgb(58_43_30)]">
                        Modelo ativo
                      </Label>
                      <select
                        id="model-select"
                        value={model}
                        onChange={(event) => {
                          const value = event.target.value;
                          const nextModel = catalog?.models.find((item) => item.id === value);
                          setModel(value);
                          setSelectedVoice(
                            value === "xtts"
                              ? null
                              : nextModel?.defaultVoice ?? nextModel?.voices[0]?.id ?? null,
                          );
                          setError(null);
                        }}
                        className="flex h-12 w-full items-center rounded-[1.15rem] border border-[rgb(82_64_46_/0.14)] bg-[rgb(255_255_255_/0.65)] px-4 py-2 text-sm text-[rgb(47_35_25)] outline-none ring-offset-background focus:ring-2 focus:ring-[rgb(168_120_82_/0.3)] focus:ring-offset-2"
                      >
                        {(modelOptions.length ? modelOptions : catalog?.models ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-[1.5rem] border border-[rgb(82_64_46_/0.12)] bg-[rgb(255_255_255_/0.55)] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="rounded-full border-[rgb(91_70_49_/0.16)] bg-[rgb(255_255_255_/0.72)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.14em] text-[rgb(73_57_43)]"
                        >
                          {currentModel?.name ?? model}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-[rgb(91_70_49_/0.16)] bg-[rgb(255_255_255_/0.72)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.14em] text-[rgb(73_57_43)]"
                        >
                          {currentModelAllowsSpeakerWav ? "WAV obrigatorio" : "voz pronta"}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-[rgb(91_70_49_/0.16)] bg-[rgb(255_255_255_/0.72)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.14em] text-[rgb(73_57_43)]"
                        >
                          {currentModelAllowsSpeed ? "speed livre" : "speed fixo"}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm leading-7 text-[rgb(74_58_42)]">{modelDescriptor}</p>
                    </div>

                    {showSpeakerPicker ? (
                      <div className="grid gap-3 rounded-[1.5rem] border border-[rgb(82_64_46_/0.12)] bg-[rgb(255_255_255_/0.55)] p-4">
                        <div>
                          <p className="text-[0.68rem] uppercase tracking-[0.2em] text-[rgb(110_91_74_/0.72)]">
                            WAV de referencia
                          </p>
                          <p className="mt-2 text-sm leading-7 text-[rgb(74_58_42)]">
                            Use um trecho limpo para definir a identidade da voz clonada.
                          </p>
                        </div>
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                          <div className="grid gap-2">
                            <Label htmlFor="speaker-wav" className="text-[rgb(58_43_30)]">
                              Arquivo WAV
                            </Label>
                            <Input
                              id="speaker-wav"
                              value={speakerWav}
                              onChange={(event) => setSpeakerWav(event.target.value)}
                              placeholder="Escolha o WAV de referencia"
                              className="h-12 rounded-[1.1rem] border-[rgb(82_64_46_/0.14)] bg-[rgb(255_255_255_/0.65)] px-4 text-[rgb(47_35_25)] placeholder:text-[rgb(119_100_82)]"
                            />
                          </div>
                          <Button variant="outline" onClick={chooseSpeakerWav} className="rounded-full px-5">
                            <Volume2 className="size-4" />
                            Escolher WAV
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-4 rounded-[2rem] border border-[rgb(70_54_36_/0.12)] bg-[rgb(255_255_255_/0.38)] p-5">
                    {!showSpeakerPicker ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[0.68rem] uppercase tracking-[0.2em] text-[rgb(110_91_74_/0.72)]">
                              Biblioteca de vozes
                            </p>
                            <p className="mt-2 text-sm leading-7 text-[rgb(74_58_42)]">
                              Filtre pelo nome ou codigo da voz e confirme a escolha antes do lote.
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className="rounded-full border-[rgb(91_70_49_/0.16)] bg-[rgb(255_255_255_/0.72)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.14em] text-[rgb(73_57_43)]"
                          >
                            {availableVoices.length} opcoes
                          </Badge>
                        </div>

                        <div className="grid gap-2">
                          <Label htmlFor="voice-filter" className="text-[rgb(58_43_30)]">
                            Buscar voz
                          </Label>
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[rgb(118_98_78)]" />
                            <Input
                              id="voice-filter"
                              value={voiceFilter}
                              onChange={(event) => setVoiceFilter(event.target.value)}
                              placeholder="Filtrar por nome ou codigo"
                              className="h-12 rounded-[1.1rem] border-[rgb(82_64_46_/0.14)] bg-[rgb(255_255_255_/0.65)] px-10 text-[rgb(47_35_25)] placeholder:text-[rgb(119_100_82)]"
                            />
                          </div>
                        </div>

                        <ScrollArea className="max-h-80 pr-3">
                          <div className="grid gap-2 md:grid-cols-2">
                            {availableVoices.map((voice) => {
                              const selected = selectedVoice === voice.id;
                              return (
                                <button
                                  key={voice.id}
                                  type="button"
                                  onClick={() => setSelectedVoice(voice.id)}
                                  className={cn(
                                    "rounded-[1.35rem] border px-4 py-4 text-left transition-all hover:-translate-y-0.5",
                                    selected
                                      ? "border-[rgb(164_114_74_/0.35)] bg-[rgb(157_116_79_/0.12)] shadow-[0_12px_30px_rgb(115_79_48_/0.08)]"
                                      : "border-[rgb(82_64_46_/0.12)] bg-[rgb(255_255_255_/0.56)] hover:border-[rgb(164_114_74_/0.25)]",
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <strong className="text-sm font-semibold text-[rgb(49_36_27)]">
                                      {voice.label}
                                    </strong>
                                    {selected ? (
                                      <CheckCircle2 className="size-4 text-[rgb(156_109_71)]" />
                                    ) : null}
                                  </div>
                                  <p className="mt-1 text-xs tracking-[0.05em] text-[rgb(111_92_73)]">
                                    {voice.id}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </>
                    ) : (
                      <div className="rounded-[1.5rem] border border-[rgb(82_64_46_/0.12)] bg-[rgb(255_255_255_/0.55)] p-5">
                        <p className="text-[0.68rem] uppercase tracking-[0.2em] text-[rgb(110_91_74_/0.72)]">
                          Timbre selecionado
                        </p>
                        <p className="mt-3 text-sm leading-7 text-[rgb(74_58_42)]">
                          O XTTS vai usar o WAV informado como referencia principal da sessao.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="grid gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[rgb(110_91_74_/0.7)]">
                      Disparo
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[rgb(45_33_24)]">
                      Lance o lote quando a sessao estiver limpa
                    </h3>
                  </div>
                </div>

                <div className="grid gap-4 rounded-[2rem] border border-[rgb(70_54_36_/0.12)] bg-[rgb(255_255_255_/0.38)] p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    {validationHints.length ? (
                      validationHints.map((hint) => (
                        <Badge
                          key={hint}
                          variant="outline"
                          className="rounded-full border-[rgb(156_94_75_/0.25)] bg-[rgb(169_111_93_/0.1)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.12em] text-[rgb(128_74_58)]"
                        >
                          <AlertCircle className="size-3.5" />
                          {hint}
                        </Badge>
                      ))
                    ) : (
                      <Badge
                        variant="outline"
                        className="rounded-full border-[rgb(84_112_80_/0.22)] bg-[rgb(95_133_84_/0.1)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.12em] text-[rgb(76_99_61)]"
                      >
                        <CheckCircle2 className="size-3.5" />
                        Sessao pronta para converter
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button onClick={startConversion} disabled={!canStart} className="min-w-52 rounded-full px-6">
                      <Play className="size-4" />
                      {busy ? "Processando..." : "Iniciar conversao"}
                    </Button>
                    <Button variant="outline" onClick={resetForm} className="rounded-full px-6">
                      <RefreshCcw className="size-4" />
                      Redefinir mesa
                    </Button>
                  </div>

                  {error ? (
                    <div className="rounded-[1.4rem] border border-[rgb(156_94_75_/0.22)] bg-[rgb(169_111_93_/0.08)] px-4 py-3 text-sm leading-6 text-[rgb(119_68_54)]">
                      {error}
                    </div>
                  ) : null}
                </div>
              </section>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card className="border-white/10 bg-[linear-gradient(180deg,rgb(22_24_30_/0.96),rgb(18_18_22_/0.98))] xl:sticky xl:top-6">
              <CardHeader className="gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Sessao em curso
                    </p>
                    <CardTitle className="mt-2 font-['Fraunces'] text-3xl tracking-[-0.03em] text-foreground">
                      Painel do lote
                    </CardTitle>
                  </div>
                  <Badge className={statusBadgeClass(job.status)} variant="outline">
                    {job.status}
                  </Badge>
                </div>
                <CardDescription className="text-[0.95rem] leading-7 text-[rgb(208_213_222_/0.74)]">
                  Arquivo, chunk, tempo e destino final reunidos em um mesmo painel de leitura.
                </CardDescription>
              </CardHeader>

              <CardContent className="grid gap-5">
                <div className="rounded-[1.7rem] border border-white/10 bg-white/[0.04] p-5">
                  <div className="flex items-center gap-3">
                    <div className="grid size-12 place-items-center rounded-[1.2rem] bg-[rgb(209_171_129_/0.14)] text-[rgb(231_209_184)]">
                      <Gauge className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{job.message}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        {statusLabel}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                        Ritmo atual
                      </p>
                      <p className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-foreground">
                        {formatPercent(totalProgress)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                        Tempo
                      </p>
                      <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[rgb(232_211_189)]">
                        {timerLabel}
                      </p>
                    </div>
                  </div>
                  <Progress className="mt-5 h-2.5 bg-white/8" value={Math.round(totalProgress * 100)} />
                </div>

                <div className="grid gap-3">
                  <div className="rounded-[1.45rem] border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">
                      Arquivo
                    </p>
                    <p className="mt-2 text-sm leading-6 text-foreground">{fileProgressLabel}</p>
                  </div>
                  <div className="rounded-[1.45rem] border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">
                      Chunk
                    </p>
                    <p className="mt-2 text-sm leading-6 text-foreground">{chunkProgressLabel}</p>
                  </div>
                  <div className="rounded-[1.45rem] border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">
                      Destino
                    </p>
                    <p className="mt-2 text-sm leading-6 text-foreground">{outputLabel}</p>
                  </div>
                </div>

                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-between rounded-[1.45rem] border border-white/10 bg-white/[0.03] px-4 py-6 hover:bg-white/[0.06]"
                    >
                      <span className="flex items-center gap-2">
                        <Settings2 className="size-4" />
                        Ajustes avancados
                      </span>
                      <ChevronDown
                        className={cn("size-4 transition-transform", advancedOpen && "rotate-180")}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4">
                    <div className="grid gap-4 rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor="start-at">Start at</Label>
                          <Input
                            id="start-at"
                            type="number"
                            min={1}
                            value={startAt}
                            onChange={(event) => setStartAt(Number(event.target.value) || 1)}
                            className="h-11 rounded-[1rem] border-white/10 bg-black/10 px-4"
                          />
                          <p className="text-xs text-muted-foreground">
                            Chunk inicial no arquivo unico ou capitulo inicial na pasta.
                          </p>
                        </div>

                        <div className="grid gap-2">
                          <Label htmlFor="workers">Workers</Label>
                          <Input
                            id="workers"
                            type="number"
                            min={1}
                            value={maxWorkers}
                            onChange={(event) => setMaxWorkers(Number(event.target.value) || 1)}
                            className="h-11 rounded-[1rem] border-white/10 bg-black/10 px-4"
                          />
                          <p className="text-xs text-muted-foreground">Paralelismo por chunk.</p>
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label htmlFor="speed">Velocidade</Label>
                          <Badge variant="secondary">
                            {currentModelAllowsSpeed ? `${speed.toFixed(1)}x` : "Fixo"}
                          </Badge>
                        </div>
                        <Slider
                          id="speed"
                          min={0.5}
                          max={2}
                          step={0.1}
                          value={[speed]}
                          onValueChange={(values) => setSpeed(values[0] ?? 1)}
                          disabled={!currentModelAllowsSpeed}
                        />
                        <p className="text-xs text-muted-foreground">
                          {currentModelAllowsSpeed
                            ? "Ajuste fino para leitura mais lenta ou mais natural."
                            : "Este modelo nao expoe velocidade ajustavel."}
                        </p>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>

            {(sourceMode !== "file" || jobFiles.length > 1) && (
              <Card className="border-white/10 bg-[linear-gradient(180deg,rgb(22_24_30_/0.96),rgb(18_18_22_/0.98))]">
                <CardHeader className="gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                        Capitulos
                      </p>
                      <CardTitle className="mt-2 font-['Fraunces'] text-3xl tracking-[-0.03em] text-foreground">
                        Painel por arquivo
                      </CardTitle>
                    </div>
                    <Badge variant="outline">{jobFiles.length} itens</Badge>
                  </div>
                  <CardDescription className="text-[0.95rem] leading-7 text-[rgb(208_213_222_/0.74)]">
                    Veja o lote inteiro, identifique falhas e recrie somente o capítulo necessário.
                  </CardDescription>
                </CardHeader>

                <CardContent className="grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[1.3rem] border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">
                        Convertidos
                      </p>
                      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                        {convertedFiles}
                      </p>
                    </div>
                    <div className="rounded-[1.3rem] border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">
                        Com erro
                      </p>
                      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[rgb(228_176_160)]">
                        {failedFiles}
                      </p>
                    </div>
                    <div className="rounded-[1.3rem] border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">
                        Em fila
                      </p>
                      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[rgb(240_221_200)]">
                        {pendingFiles}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {jobFiles.length ? (
                      jobFiles.map((file) => {
                        const canRetry = file.status === "error" && !busy;
                        const fileTone =
                          file.status === "completed"
                            ? "border-[rgb(105_141_105_/0.2)] bg-[rgb(90_126_84_/0.08)]"
                            : file.status === "error"
                              ? "border-[rgb(156_94_75_/0.24)] bg-[rgb(169_111_93_/0.08)]"
                              : "border-white/10 bg-white/[0.03]";

                        return (
                          <div
                            key={file.path}
                            className={cn("rounded-[1.45rem] border p-4 transition-colors", fileTone)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">
                                  Capitulo {file.index}
                                </p>
                                <p className="mt-2 truncate text-sm font-medium text-foreground">
                                  {file.name}
                                </p>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                  {file.error ?? file.message}
                                </p>
                              </div>
                              <Badge className={statusBadgeClass(file.status)} variant="outline">
                                {file.status}
                              </Badge>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                {file.total_chunks
                                  ? `${file.completed_chunks}/${file.total_chunks} chunks`
                                  : "Sem chunks registrados"}
                              </p>
                              {canRetry ? (
                                <Button
                                  size="sm"
                                  onClick={() => retryFile(file.path)}
                                  className="rounded-full px-4"
                                >
                                  <RefreshCcw className="size-4" />
                                  Recriar
                                </Button>
                              ) : file.output_path && file.status === "completed" ? (
                                <p className="text-xs uppercase tracking-[0.18em] text-[rgb(196_220_186)]">
                                  convertido
                                </p>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-[1.45rem] border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm leading-6 text-muted-foreground">
                        Os cards de capítulo aparecem aqui quando você selecionar múltiplos arquivos
                        ou uma pasta para converter em lote.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
