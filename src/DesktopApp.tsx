import { useEffect, useMemo, useState } from "react";
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
  SlidersHorizontal,
  Sparkles,
  Volume2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
    label: "Arquivo único",
    description: "Um texto isolado, pronto para virar um MP3.",
    actionLabel: "Escolher arquivo Markdown",
    icon: FileText,
  },
  {
    id: "files",
    label: "Vários arquivos",
    description: "Lote de capítulos para converter em sequência.",
    actionLabel: "Escolher arquivos Markdown",
    icon: Files,
  },
  {
    id: "directory",
    label: "Pasta",
    description: "Uma pasta inteira escaneada pelo backend.",
    actionLabel: "Escolher pasta de entrada",
    icon: FolderOpen,
  },
];

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

function statusBadgeClass(status: string) {
  if (status === "error") {
    return "border-destructive/30 bg-destructive/15 text-destructive-foreground";
  }

  if (status === "completed") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-50";
  }

  if (status === "running") {
    return "border-primary/30 bg-primary/15 text-primary-foreground";
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    invoke<Catalog>("get_catalog")
      .then((data) => {
        setCatalog(data);
        const defaultModelId = data.defaultModel || "edge";
        setModel(defaultModelId);
        const defaultModel = data.models.find((item) => item.id === defaultModelId);

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

    const query = (voiceFilter ?? "").trim().toLowerCase();
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

    if (sourceMode === "directory") {
      return `${formatSelectionLabel(inputs[0])} · pasta`;
    }

    if (sourceMode === "file") {
      return `${formatSelectionLabel(inputs[0])} · arquivo`;
    }

    return `${inputs.length} arquivos selecionados`;
  }, [inputs, sourceMode]);

  const totalProgress = job.total_chunks > 0 ? job.completed_chunks / job.total_chunks : job.progress;
  const visibleFiles = inputPreview?.files.slice(0, 4) ?? [];
  const sourceModeConfig =
    sourceModeOptions.find((item) => item.id === sourceMode) ?? sourceModeOptions[0];
  const currentModelAllowsSpeed = currentModel?.supportsSpeed ?? false;
  const showSpeakerPicker = currentModel?.supportsSpeakerWav ?? false;
  const activeVoiceLabel = showSpeakerPicker
    ? "WAV de referência"
    : selectedVoice ?? "voz automática";
  const outputLabel = outputDir ? formatSelectionLabel(outputDir) : "sem saída";
  const selectedFiles = inputs.map((path) => formatSelectionLabel(path)).slice(0, 5);
  const canStart =
    !busy &&
    inputs.length > 0 &&
    outputDir.length > 0 &&
    (!showSpeakerPicker || speakerWav.length > 0);
  const validationHints = [
    inputs.length > 0 ? null : "Escolha um arquivo ou uma pasta.",
    outputDir ? null : "Defina a pasta de saída.",
    showSpeakerPicker && !speakerWav ? "XTTS exige um WAV de referência." : null,
  ].filter(Boolean) as string[];

  const topRailStats = [
    {
      label: "Entrada",
      value: sourceModeConfig.label,
    },
    {
      label: "Modelo",
      value: currentModel?.name ?? model,
    },
    {
      label: "Saída",
      value: outputLabel,
    },
  ];

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
      setSourceMode(normalized.length > 1 ? "files" : "file");
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
      setSourceMode("directory");
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

  const currentModelAllowsSpeakerWav = currentModel?.supportsSpeakerWav ?? false;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgb(212_154_103_/0.18),transparent_26%),radial-gradient(circle_at_88%_16%,rgb(115_150_208_/0.2),transparent_24%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255_/0.015),transparent_42%,rgb(255_255_255_/0.015))]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1720px] flex-col gap-6 p-4 sm:p-6 xl:p-8">
        <header className="grid gap-4 rounded-[2rem] border border-border/70 bg-card/80 p-4 shadow-2xl shadow-black/20 backdrop-blur xl:grid-cols-[1.05fr_1.55fr_0.9fr] xl:p-5">
          <div className="flex items-center gap-4">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/15">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                Audiobook TTS Workbench
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Conversão em lote com controle de produção
              </h1>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {topRailStats.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3"
              >
                <p className="text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-sm font-medium leading-snug text-foreground">
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
            <span
              className={cn(
                "mt-1 size-3 rounded-full",
                job.status === "error"
                  ? "bg-destructive"
                  : job.status === "completed"
                    ? "bg-emerald-400"
                    : "bg-primary",
              )}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={statusBadgeClass(job.status)} variant="outline">
                  {job.status}
                </Badge>
                {busy ? (
                  <Badge variant="secondary" className="gap-1">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    processando
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {job.message}
              </p>
            </div>
          </div>
        </header>

        <main className="grid gap-6">
          <Card className="border-white/10 bg-card/90">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Navegação
                  </p>
                  <CardTitle className="mt-1 text-2xl">Modelo, voz, entrada e saída</CardTitle>
                </div>
                <Badge variant="outline">
                  {catalog ? `${modelOptions.length}/${catalog.models.length}` : "0 modelos"}
                </Badge>
              </div>
              <CardDescription>
                Tudo que define a execução fica no mesmo bloco. Sem cards duplicados, sem metade da
                tela desperdiçada.
              </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-6">
              <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <section className="grid gap-4">
                  <div className="grid gap-2 rounded-3xl border border-border/70 bg-background/35 p-5">
                    <div className="grid gap-2">
                      <Label htmlFor="model-select">Modelo ativo</Label>
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
                        className="flex h-11 w-full items-center rounded-2xl border border-input bg-background/70 px-4 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      >
                        {(modelOptions.length ? modelOptions : catalog?.models ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        O padrão é `edge`. A seleção troca também o conjunto de vozes.
                      </p>
                    </div>

                    <div className="grid gap-2 rounded-3xl border border-border/70 bg-background/35 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{currentModel?.name ?? model}</Badge>
                        <Badge variant="outline">
                          {currentModel?.supportsSpeakerWav ? "WAV de referência" : "voz pronta"}
                        </Badge>
                        <Badge variant="outline">
                          {currentModelAllowsSpeed ? "speed ajustável" : "speed fixo"}
                        </Badge>
                        <Badge variant="outline">{currentModel?.accent ?? "—"}</Badge>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {currentModel?.description ??
                          "O modelo ativo controla as vozes disponíveis e as regras de execução."}
                      </p>
                    </div>
                  </div>

                  {showSpeakerPicker ? (
                    <div className="grid gap-3 rounded-3xl border border-border/70 bg-background/35 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                            Voz
                          </p>
                          <p className="mt-1 text-xl font-semibold tracking-tight">WAV de referência</p>
                        </div>
                        <Badge variant="outline">XTTS</Badge>
                      </div>

                      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                        <div className="grid gap-2">
                          <Label htmlFor="speaker-wav">Arquivo WAV de referência</Label>
                          <Input
                            id="speaker-wav"
                            value={speakerWav}
                            onChange={(event) => setSpeakerWav(event.target.value)}
                            placeholder="Escolha o arquivo WAV de referência"
                          />
                        </div>
                        <Button variant="outline" onClick={chooseSpeakerWav}>
                          <Volume2 className="size-4" />
                          Escolher WAV
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 rounded-3xl border border-border/70 bg-background/35 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                            Voz
                          </p>
                          <p className="mt-1 text-xl font-semibold tracking-tight">Selecione uma voz</p>
                        </div>
                        <Badge variant="outline">{availableVoices.length} opções</Badge>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="voice-filter">Buscar voz</Label>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="voice-filter"
                            value={voiceFilter}
                            onChange={(event) => setVoiceFilter(event.target.value)}
                            placeholder="Filtrar por nome ou código"
                            className="pl-9"
                          />
                        </div>
                      </div>

                      <ScrollArea className="max-h-72 pr-3">
                        <div className="grid gap-2 md:grid-cols-2">
                          {availableVoices.map((voice) => {
                            const selected = selectedVoice === voice.id;
                            return (
                              <button
                                key={voice.id}
                                type="button"
                                onClick={() => setSelectedVoice(voice.id)}
                                className={cn(
                                  "rounded-2xl border px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/35",
                                  selected
                                    ? "border-primary/40 bg-primary/10 shadow-lg shadow-primary/10"
                                    : "border-border/70 bg-white/[0.025]",
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <strong className="text-sm font-semibold">{voice.label}</strong>
                                  {selected ? <CheckCircle2 className="size-4 text-primary" /> : null}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{voice.id}</p>
                              </button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </section>

                <section className="grid gap-4">
                  <div className="grid gap-3 rounded-3xl border border-border/70 bg-background/35 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                          Entrada e saída
                        </p>
                        <p className="mt-1 text-xl font-semibold tracking-tight">
                          Fonte do texto e destino do áudio
                        </p>
                      </div>
                      <Badge variant="outline">{sourceModeConfig.label}</Badge>
                    </div>

                    <Tabs value={sourceMode} onValueChange={(value) => setSourceMode(value as SourceMode)}>
                      <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl bg-white/5 p-1.5">
                        {sourceModeOptions.map((item) => {
                          const Icon = item.icon;
                          return (
                            <TabsTrigger
                              key={item.id}
                              value={item.id}
                              className="flex h-auto flex-col items-start gap-1 rounded-xl px-4 py-3 text-left data-[state=active]:bg-card data-[state=active]:shadow-md"
                            >
                              <span className="flex items-center gap-2 text-sm font-medium">
                                <Icon className="size-4 text-primary" />
                                {item.label}
                              </span>
                              <span className="text-xs font-normal text-muted-foreground">
                                {item.description}
                              </span>
                            </TabsTrigger>
                          );
                        })}
                      </TabsList>
                    </Tabs>

                    <div className="flex flex-wrap gap-3">
                      <Button onClick={sourceMode === "directory" ? chooseFolder : chooseFiles}>
                        {sourceModeConfig.actionLabel}
                      </Button>
                      <Button variant="outline" onClick={chooseOutputDir}>
                        <FolderOpen className="size-4" />
                        Escolher pasta de saída
                      </Button>
                      <Button variant="outline" onClick={resetForm}>
                        <RefreshCcw className="size-4" />
                        Limpar
                      </Button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="input-preview">Entrada atual</Label>
                        <Input
                          id="input-preview"
                          value={selectedPreview}
                          readOnly
                          placeholder="Nenhuma entrada selecionada"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="output-dir">Saída atual</Label>
                        <Input
                          id="output-dir"
                          value={outputDir}
                          readOnly
                          placeholder="Selecione a pasta de saída"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-3xl border border-border/70 bg-background/35 p-4">
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {inputPreview
                          ? inputPreview.kind === "directory"
                            ? "A pasta foi escaneada pelo backend e o app já sabe quantos capítulos processar."
                            : "O arquivo está pronto para limpeza de Markdown e chunking."
                          : "Nenhum preview carregado ainda."}
                      </p>
                    </div>
                  </div>
                </section>
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-background/35 p-4">
                <div className="flex flex-1 flex-wrap gap-2">
                  {validationHints.length ? (
                    validationHints.map((hint) => (
                      <Badge
                        key={hint}
                        variant="outline"
                        className="border-destructive/30 bg-destructive/10 text-destructive-foreground"
                      >
                        <AlertCircle className="size-3.5" />
                        {hint}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="secondary">
                      <CheckCircle2 className="size-3.5" />
                      Pronto para converter
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={startConversion} disabled={!canStart} className="min-w-44">
                    <Play className="size-4" />
                    {busy ? "Processando..." : "Iniciar conversão"}
                  </Button>
                  <Button variant="outline" onClick={resetForm}>
                    <RefreshCcw className="size-4" />
                    Redefinir
                  </Button>
                </div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {error}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/90">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Execução
                  </p>
                  <CardTitle className="mt-1 text-2xl">Estado atual</CardTitle>
                </div>
                <Badge variant="outline">{formatPercent(totalProgress)}</Badge>
              </div>
              <CardDescription>
                A tela acompanha o processo por arquivo e por chunk, sem esconder o progresso real.
              </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-5">
              <div className="grid gap-3 rounded-2xl border border-border/70 bg-background/35 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary">
                      <Gauge className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{job.message}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {job.status}
                      </p>
                    </div>
                  </div>
                  <Badge className={statusBadgeClass(job.status)} variant="outline">
                    {job.status}
                  </Badge>
                </div>

                <Progress value={Math.round(totalProgress * 100)} />

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/8 bg-white/4 p-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Arquivo
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {job.current_file_name
                        ? `${job.current_file_index}/${job.total_files} · ${job.current_file_name}`
                        : "Aguardando entrada"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/4 p-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Chunk
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {job.total_chunks
                        ? `${job.completed_chunks}/${job.total_chunks}`
                        : "Sem chunks ainda"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/4 p-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Saída
                    </p>
                    <p className="mt-1 text-sm text-foreground">{outputLabel}</p>
                  </div>
                </div>
              </div>

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-between rounded-2xl border border-border/70"
                  >
                    <span className="flex items-center gap-2">
                      <Settings2 className="size-4" />
                      Ajustes avançados
                    </span>
                    <ChevronDown
                      className={cn("size-4 transition-transform", advancedOpen && "rotate-180")}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <div className="grid gap-4 rounded-2xl border border-border/70 bg-background/35 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="start-at">Start at</Label>
                        <Input
                          id="start-at"
                          type="number"
                          min={1}
                          value={startAt}
                          onChange={(event) => setStartAt(Number(event.target.value) || 1)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Chunk inicial no arquivo único ou capítulo inicial na pasta.
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
                          : "Este modelo não expõe velocidade ajustável."}
                      </p>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        </main>

        <Card className="border-white/10 bg-card/90">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Log
                </p>
                <CardTitle className="mt-1 text-2xl">Eventos recentes</CardTitle>
              </div>
              <Badge variant="outline">{logs.length} linhas</Badge>
            </div>
            <CardDescription>
              Os eventos ficam visíveis durante a execução para rastrear o pipeline sem abrir o
              terminal.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <ScrollArea className="h-80 pr-3">
              <div className="grid gap-2">
                {logs.length ? (
                  logs
                    .slice(-20)
                    .reverse()
                    .map((line, index) => (
                      <div
                        key={`${index}-${line}`}
                        className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm leading-relaxed text-muted-foreground"
                      >
                        {line}
                      </div>
                    ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-10 text-center">
                    <p className="text-sm text-muted-foreground">
                      Os eventos aparecerão aqui quando a conversão começar.
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
          <CardFooter className="justify-between gap-3 border-t border-border/60 pt-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <SlidersHorizontal className="size-4 text-primary" />
              {showSpeakerPicker ? "XTTS com WAV obrigatório" : "Voz e velocidade ajustáveis"}
            </div>
            <div className="text-xs text-muted-foreground">{currentModel?.name ?? model}</div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

export default App;
