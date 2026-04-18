use crate::catalog;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
pub struct ConversionRequest {
    pub inputs: Vec<String>,
    pub output_dir: String,
    pub model: String,
    pub voice: Option<String>,
    pub speed: f32,
    pub speaker_wav: Option<String>,
    pub start_at: usize,
    pub max_workers: Option<usize>,
}

#[derive(Clone, Serialize)]
pub struct FileSnapshot {
    pub path: String,
    pub name: String,
    pub index: usize,
    pub status: String,
    pub message: String,
    pub error: Option<String>,
    pub output_path: Option<String>,
    pub completed_chunks: usize,
    pub total_chunks: usize,
}

#[derive(Clone, Serialize)]
pub struct JobSnapshot {
    pub job_id: String,
    pub status: String,
    pub message: String,
    pub progress: f32,
    pub current_file_index: usize,
    pub total_files: usize,
    pub current_file_name: Option<String>,
    pub current_chunk_index: usize,
    pub current_chunk_total: usize,
    pub completed_chunks: usize,
    pub total_chunks: usize,
    pub output_paths: Vec<String>,
    pub error: Option<String>,
    pub files: Vec<FileSnapshot>,
}

#[derive(Clone)]
struct JobRecord {
    snapshot: JobSnapshot,
    request: ConversionRequest,
}

#[derive(Clone, Default)]
pub struct AppState {
    jobs: Arc<Mutex<HashMap<String, JobRecord>>>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum FrontendEvent {
    Status {
        #[serde(flatten)]
        snapshot: JobSnapshot,
    },
    Log {
        job_id: String,
        message: String,
    },
}

#[derive(Serialize)]
pub struct InputPreview {
    pub path: String,
    pub kind: String,
    pub file_count: usize,
    pub files: Vec<String>,
}

#[derive(Serialize)]
pub struct StartResponse {
    pub job_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Deserialize)]
pub struct RetryRequest {
    pub job_id: String,
    pub file_path: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum BridgeEvent {
    JobStarted {
        message: Option<String>,
        total_files: usize,
        total_chunks: usize,
        #[serde(rename = "output_dir")]
        _output_dir: String,
    },
    FileStarted {
        message: Option<String>,
        file_index: usize,
        total_files: usize,
        file_name: String,
        chunk_total: usize,
        completed_chunks: usize,
        total_chunks: usize,
    },
    ChunkProgress {
        message: String,
        file_index: usize,
        total_files: usize,
        file_name: String,
        chunk_index: usize,
        chunk_total: usize,
        completed_chunks: usize,
        total_chunks: usize,
        #[serde(rename = "paragraph_end")]
        _paragraph_end: bool,
    },
    FileMerging {
        message: String,
        file_index: usize,
        total_files: usize,
        file_name: String,
        completed_chunks: usize,
        total_chunks: usize,
    },
    FileCompleted {
        message: String,
        file_index: usize,
        total_files: usize,
        file_name: String,
        output_path: String,
        completed_chunks: usize,
        total_chunks: usize,
        progress: f32,
    },
    FileFailed {
        message: String,
        file_index: usize,
        total_files: usize,
        file_name: String,
        completed_chunks: usize,
        total_chunks: usize,
    },
    JobCompleted {
        message: String,
        output_paths: Vec<String>,
        progress: f32,
        total_files: usize,
        total_chunks: usize,
        failed_files: usize,
    },
    Error {
        message: String,
        output_paths: Vec<String>,
        total_files: usize,
        total_chunks: usize,
        progress: f32,
    },
}

enum RunMode {
    Batch,
    Retry { target_index: usize },
}

#[tauri::command]
pub fn get_catalog() -> catalog::Catalog {
    catalog::catalog()
}

#[tauri::command]
pub fn inspect_input(path: String) -> Result<InputPreview, String> {
    let input_path = PathBuf::from(&path);
    if !input_path.exists() {
        return Err(format!("Entrada não encontrada: {path}"));
    }

    if input_path.is_dir() {
        let files = list_markdown_files(&input_path)?;
        let labels = files
            .iter()
            .map(|item| {
                item.as_path()
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| item.display().to_string())
            })
            .collect::<Vec<_>>();

        return Ok(InputPreview {
            path,
            kind: "directory".to_string(),
            file_count: files.len(),
            files: labels,
        });
    }

    Ok(InputPreview {
        path,
        kind: "file".to_string(),
        file_count: 1,
        files: vec![input_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| input_path.display().to_string())],
    })
}

#[tauri::command]
pub fn cancel_conversion(job_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut jobs = state.jobs.lock().expect("job store poisoned");
    if let Some(record) = jobs.get_mut(&job_id) {
        record.snapshot.status = "cancelled".to_string();
        record.snapshot.message = "Conversão cancelada pelo usuário".to_string();
    }
    Ok(())
}

#[tauri::command]
pub fn start_conversion(
    request: ConversionRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<StartResponse, String> {
    validate_request(&request)?;
    let files = build_file_snapshots(&request)?;
    let total_files = files.len();
    let job_id = Uuid::new_v4().to_string();
    let snapshot = JobSnapshot {
        job_id: job_id.clone(),
        status: "queued".to_string(),
        message: "Aguardando o worker iniciar".to_string(),
        progress: 0.0,
        current_file_index: 0,
        total_files,
        current_file_name: None,
        current_chunk_index: 0,
        current_chunk_total: 0,
        completed_chunks: 0,
        total_chunks: 0,
        output_paths: vec![],
        error: None,
        files,
    };

    {
        let mut jobs = state.jobs.lock().expect("job store poisoned");
        jobs.insert(
            job_id.clone(),
            JobRecord {
                snapshot: snapshot.clone(),
                request: request.clone(),
            },
        );
    }

    emit_status(&app, &snapshot);

    let app_state = state.inner().clone();
    let spawn_job_id = job_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_worker(app.clone(), app_state.clone(), spawn_job_id.clone(), request, RunMode::Batch).await {
            let _ = set_job_error(&app, &app_state, &spawn_job_id, None, error);
        }
    });

    Ok(StartResponse {
        job_id,
        status: "queued".to_string(),
        message: "Conversão agendada".to_string(),
    })
}

#[tauri::command]
pub fn retry_file_conversion(
    request: RetryRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<StartResponse, String> {
    let RetryRequest { job_id, file_path } = request;
    let (retry_request, target_index) = {
        let mut jobs = state.jobs.lock().expect("job store poisoned");
        let record = jobs
            .get_mut(&job_id)
            .ok_or_else(|| format!("Job não encontrado: {job_id}"))?;

        if record.snapshot.status == "running" {
            return Err("Aguarde o lote atual terminar antes de recriar um capítulo.".to_string());
        }

        let target_index = record
            .snapshot
            .files
            .iter()
            .position(|file| file.path == file_path)
            .ok_or_else(|| format!("Arquivo não encontrado no job: {file_path}"))?;

        let file = &mut record.snapshot.files[target_index];
        file.status = "retrying".to_string();
        file.message = "Recriando capítulo".to_string();
        file.error = None;
        file.output_path = None;
        file.completed_chunks = 0;
        file.total_chunks = 0;
        record.snapshot.status = "running".to_string();
        record.snapshot.message = format!("Recriando {}", file.name);
        record.snapshot.error = None;
        record.snapshot.current_file_index = file.index;
        record.snapshot.current_file_name = Some(file.name.clone());
        recompute_job_totals(&mut record.snapshot);
        (clone_request_for_single_file(&record.request, &file_path), target_index)
    };

    emit_status_from_state(&app, &state, &job_id)?;

    let app_state = state.inner().clone();
    let retry_job_id = job_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) =
            run_worker(app.clone(), app_state.clone(), retry_job_id.clone(), retry_request, RunMode::Retry { target_index })
                .await
        {
            let _ = set_job_error(&app, &app_state, &retry_job_id, Some(target_index), error);
        }
    });

    Ok(StartResponse {
        job_id,
        status: "running".to_string(),
        message: "Recriação iniciada".to_string(),
    })
}

async fn run_worker(
    app: AppHandle,
    state: AppState,
    job_id: String,
    request: ConversionRequest,
    mode: RunMode,
) -> Result<(), String> {
    let root_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Não foi possível resolver o diretório raiz".to_string())?
        .to_path_buf();
    let bridge_path = root_dir.join("desktop_bridge.py");
    let python_path = resolve_python_executable(&root_dir)?;

    let mut command = Command::new(&python_path);
    command
        .arg(&bridge_path)
        .arg("--output-dir")
        .arg(&request.output_dir)
        .arg("--model")
        .arg(&request.model)
        .arg("--speed")
        .arg(request.speed.to_string())
        .arg("--start-at")
        .arg(request.start_at.to_string())
        .current_dir(&root_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(selected_voice) = &request.voice {
        command.arg("--voice").arg(selected_voice);
    }

    if let Some(reference) = &request.speaker_wav {
        command.arg("--speaker-wav").arg(reference);
    }

    if let Some(workers) = request.max_workers {
        command.arg("--max-workers").arg(workers.to_string());
    }

    for input in &request.inputs {
        command.arg("--input").arg(input);
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Falha ao capturar stdout do bridge".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Falha ao capturar stderr do bridge".to_string())?;

    let stderr_job_id = job_id.clone();
    let stderr_app = app.clone();
    let stderr_lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_lines_clone = stderr_lines.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            {
                let mut lines = stderr_lines_clone.lock().expect("stderr buffer poisoned");
                lines.push(line.clone());
                if lines.len() > 20 {
                    let overflow = lines.len() - 20;
                    lines.drain(0..overflow);
                }
            }
            let _ = stderr_app.emit(
                "tts-event",
                FrontendEvent::Log {
                    job_id: stderr_job_id.clone(),
                    message: line,
                },
            );
        }
    });

    let mut reader = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        handle_bridge_line(&app, &state, &job_id, &line, &mode)?;
    }

    let status = child.wait().await.map_err(|error| error.to_string())?;
    if !status.success() {
        let buffered_stderr = {
            let lines = stderr_lines.lock().expect("stderr buffer poisoned");
            lines.join("\n")
        };
        let detail = if buffered_stderr.is_empty() {
            "O processo do bridge terminou com erro".to_string()
        } else {
            format!("O processo do bridge terminou com erro.\n\nÚltimos logs:\n{}", buffered_stderr)
        };

        let target_index = match mode {
            RunMode::Batch => current_running_file_index(&state, &job_id)?,
            RunMode::Retry { target_index } => Some(target_index),
        };
        set_job_error(&app, &state, &job_id, target_index, detail)?;
    }

    Ok(())
}

fn handle_bridge_line(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    line: &str,
    mode: &RunMode,
) -> Result<(), String> {
    let parsed: Result<BridgeEvent, _> = serde_json::from_str(line);
    match parsed {
        Ok(event) => match event {
            BridgeEvent::JobStarted {
                message,
                total_files,
                total_chunks,
                _output_dir: _,
            } => {
                update_job(state, job_id, |job| {
                    job.status = "running".to_string();
                    job.message = message.unwrap_or_else(|| "Job iniciado".to_string());
                    if matches!(mode, RunMode::Batch) {
                        job.total_files = total_files;
                        job.total_chunks = total_chunks;
                    }
                })?;
            }
            BridgeEvent::FileStarted {
                message,
                file_index,
                total_files: _,
                file_name,
                chunk_total,
                completed_chunks: _,
                total_chunks: _,
            } => {
                update_job(state, job_id, |job| {
                    let index = resolve_target_index(mode, file_index);
                    if let Some(file) = job.files.get_mut(index) {
                        file.status = "running".to_string();
                        file.message = message.unwrap_or_else(|| format!("Processando {file_name}"));
                        file.error = None;
                        file.total_chunks = chunk_total;
                        file.completed_chunks = 0;
                    }
                    job.status = "running".to_string();
                    job.current_file_index = index + 1;
                    job.current_file_name = Some(file_name);
                    job.current_chunk_index = 0;
                    job.current_chunk_total = chunk_total;
                    recompute_job_totals(job);
                })?;
            }
            BridgeEvent::ChunkProgress {
                message,
                file_index,
                total_files: _,
                file_name,
                chunk_index,
                chunk_total,
                completed_chunks: _,
                total_chunks: _,
                _paragraph_end: _,
            } => {
                update_job(state, job_id, |job| {
                    let index = resolve_target_index(mode, file_index);
                    if let Some(file) = job.files.get_mut(index) {
                        file.status = "running".to_string();
                        file.message = message.clone();
                        file.total_chunks = chunk_total;
                        file.completed_chunks = chunk_index.min(chunk_total);
                    }
                    job.status = "running".to_string();
                    job.current_file_index = index + 1;
                    job.current_file_name = Some(file_name);
                    job.current_chunk_index = chunk_index;
                    job.current_chunk_total = chunk_total;
                    recompute_job_totals(job);
                })?;
            }
            BridgeEvent::FileMerging {
                message,
                file_index,
                total_files: _,
                file_name,
                completed_chunks: _,
                total_chunks: _,
            } => {
                update_job(state, job_id, |job| {
                    let index = resolve_target_index(mode, file_index);
                    if let Some(file) = job.files.get_mut(index) {
                        file.status = "merging".to_string();
                        file.message = message.clone();
                        if file.total_chunks > 0 {
                            file.completed_chunks = file.total_chunks;
                        }
                    }
                    job.status = "running".to_string();
                    job.message = message;
                    job.current_file_index = index + 1;
                    job.current_file_name = Some(file_name);
                    recompute_job_totals(job);
                })?;
            }
            BridgeEvent::FileCompleted {
                message,
                file_index,
                total_files: _,
                file_name,
                output_path,
                completed_chunks: _,
                total_chunks: _,
                progress: _,
            } => {
                update_job(state, job_id, |job| {
                    let index = resolve_target_index(mode, file_index);
                    if let Some(file) = job.files.get_mut(index) {
                        file.status = "completed".to_string();
                        file.message = message.clone();
                        file.error = None;
                        file.output_path = Some(output_path.clone());
                        if file.total_chunks > 0 {
                            file.completed_chunks = file.total_chunks;
                        }
                    }
                    job.message = message;
                    job.current_file_index = index + 1;
                    job.current_file_name = Some(file_name);
                    recompute_job_totals(job);
                })?;
            }
            BridgeEvent::FileFailed {
                message,
                file_index,
                total_files: _,
                file_name,
                completed_chunks: _,
                total_chunks: _,
            } => {
                update_job(state, job_id, |job| {
                    let index = resolve_target_index(mode, file_index);
                    if let Some(file) = job.files.get_mut(index) {
                        file.status = "error".to_string();
                        file.message = format!("Falha em {}", file.name);
                        file.error = Some(message.clone());
                    }
                    job.message = format!("Falha em {}", file_name);
                    job.current_file_index = index + 1;
                    job.current_file_name = Some(file_name);
                    recompute_job_totals(job);
                })?;
            }
            BridgeEvent::JobCompleted {
                message,
                output_paths,
                progress: _,
                total_files: _,
                total_chunks: _,
                failed_files,
            } => {
                update_job(state, job_id, |job| {
                    job.output_paths = collect_output_paths(job);
                    if matches!(mode, RunMode::Batch) && !output_paths.is_empty() {
                        job.output_paths = output_paths;
                    }
                    job.message = message;
                    job.error = None;
                    recompute_job_totals(job);
                    if failed_files > 0 || job.files.iter().any(|file| file.status == "error") {
                        job.status = "completed_with_errors".to_string();
                    } else {
                        job.status = "completed".to_string();
                    }
                })?;
            }
            BridgeEvent::Error {
                message,
                output_paths: _,
                total_files: _,
                total_chunks: _,
                progress: _,
            } => {
                let target_index = match mode {
                    RunMode::Batch => current_running_file_index(state, job_id)?,
                    RunMode::Retry { target_index } => Some(*target_index),
                };
                set_job_error(app, state, job_id, target_index, message)?;
                return Ok(());
            }
        },
        Err(_) => {
            let _ = app.emit(
                "tts-event",
                FrontendEvent::Log {
                    job_id: job_id.to_string(),
                    message: line.to_string(),
                },
            );
            return Ok(());
        }
    }

    emit_status_from_state(app, state, job_id)?;
    Ok(())
}

fn validate_request(request: &ConversionRequest) -> Result<(), String> {
    if request.inputs.is_empty() {
        return Err("Selecione ao menos uma entrada".to_string());
    }
    if request.output_dir.trim().is_empty() {
        return Err("Selecione uma pasta de saída".to_string());
    }
    Ok(())
}

fn build_file_snapshots(request: &ConversionRequest) -> Result<Vec<FileSnapshot>, String> {
    let files = expand_inputs(&request.inputs)?;
    let files = apply_start_at(files, request.start_at)?;
    let output_dir = PathBuf::from(&request.output_dir);
    let mut used_names: HashMap<String, usize> = HashMap::new();
    let mut snapshots = Vec::new();

    for (index, path) in files.into_iter().enumerate() {
        let stem = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| path.display().to_string());
        let count = used_names.entry(stem.clone()).or_insert(0);
        *count += 1;
        let output_stem = if *count > 1 {
            format!("{stem}_{}", *count)
        } else {
            stem
        };
        let output_path = output_dir.join(format!("{output_stem}.mp3"));

        snapshots.push(FileSnapshot {
            path: path.to_string_lossy().to_string(),
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| path.display().to_string()),
            index: index + 1,
            status: "queued".to_string(),
            message: "Aguardando".to_string(),
            error: None,
            output_path: Some(output_path.to_string_lossy().to_string()),
            completed_chunks: 0,
            total_chunks: 0,
        });
    }

    Ok(snapshots)
}

fn clone_request_for_single_file(request: &ConversionRequest, file_path: &str) -> ConversionRequest {
    ConversionRequest {
        inputs: vec![file_path.to_string()],
        output_dir: request.output_dir.clone(),
        model: request.model.clone(),
        voice: request.voice.clone(),
        speed: request.speed,
        speaker_wav: request.speaker_wav.clone(),
        start_at: 1,
        max_workers: request.max_workers,
    }
}

fn expand_inputs(raw_inputs: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for input in raw_inputs {
        let path = PathBuf::from(input).expand_home();
        if !path.exists() {
            return Err(format!("Entrada não encontrada: {}", path.display()));
        }
        if path.is_dir() {
            let mut directory_files = list_markdown_files(&path)?;
            files.append(&mut directory_files);
        } else {
            files.push(path);
        }
    }
    if files.is_empty() {
        return Err("Nenhuma entrada Markdown foi encontrada".to_string());
    }
    Ok(files)
}

fn apply_start_at(files: Vec<PathBuf>, start_at: usize) -> Result<Vec<PathBuf>, String> {
    if files.len() <= 1 {
        return Ok(files);
    }
    if start_at < 1 {
        return Err("--start-at deve ser maior ou igual a 1".to_string());
    }
    if start_at > files.len() {
        return Err(format!(
            "--start-at={start_at} é maior que a quantidade de arquivos ({})",
            files.len()
        ));
    }
    Ok(files.into_iter().skip(start_at - 1).collect())
}

fn resolve_python_executable(root_dir: &Path) -> Result<PathBuf, String> {
    let venv_python = root_dir.join(".venv").join("bin").join("python");
    if venv_python.exists() {
        return Ok(venv_python);
    }

    let venv_python3 = root_dir.join(".venv").join("bin").join("python3");
    if venv_python3.exists() {
        return Ok(venv_python3);
    }

    Ok(PathBuf::from("python3"))
}

fn resolve_target_index(mode: &RunMode, file_index: usize) -> usize {
    match mode {
        RunMode::Batch => file_index.saturating_sub(1),
        RunMode::Retry { target_index } => *target_index,
    }
}

fn current_running_file_index(state: &AppState, job_id: &str) -> Result<Option<usize>, String> {
    let jobs = state.jobs.lock().expect("job store poisoned");
    let record = jobs
        .get(job_id)
        .ok_or_else(|| format!("Job não encontrado: {job_id}"))?;
    if record.snapshot.current_file_index == 0 {
        return Ok(None);
    }
    Ok(Some(record.snapshot.current_file_index - 1))
}

fn collect_output_paths(job: &JobSnapshot) -> Vec<String> {
    job.files
        .iter()
        .filter_map(|file| {
            if file.status == "completed" {
                file.output_path.clone()
            } else {
                None
            }
        })
        .collect()
}

fn recompute_job_totals(job: &mut JobSnapshot) {
    job.total_files = job.files.len();
    job.total_chunks = job.files.iter().map(|file| file.total_chunks).sum();
    job.completed_chunks = job.files.iter().map(|file| file.completed_chunks).sum();
    job.progress = if job.total_chunks > 0 {
        job.completed_chunks as f32 / job.total_chunks as f32
    } else if !job.files.is_empty() {
        let completed = job
            .files
            .iter()
            .filter(|file| file.status == "completed")
            .count();
        completed as f32 / job.files.len() as f32
    } else {
        0.0
    };
    job.output_paths = collect_output_paths(job);
}

fn emit_status_from_state(app: &AppHandle, state: &AppState, job_id: &str) -> Result<(), String> {
    let snapshot = {
        let jobs = state.jobs.lock().expect("job store poisoned");
        jobs.get(job_id)
            .map(|record| record.snapshot.clone())
            .ok_or_else(|| format!("Job não encontrado: {job_id}"))?
    };
    emit_status(app, &snapshot);
    Ok(())
}

fn emit_status(app: &AppHandle, snapshot: &JobSnapshot) {
    let _ = app.emit(
        "tts-event",
        FrontendEvent::Status {
            snapshot: snapshot.clone(),
        },
    );
}

fn update_job(
    state: &AppState,
    job_id: &str,
    mutate: impl FnOnce(&mut JobSnapshot),
) -> Result<(), String> {
    let mut jobs = state.jobs.lock().expect("job store poisoned");
    let record = jobs
        .get_mut(job_id)
        .ok_or_else(|| format!("Job não encontrado: {job_id}"))?;
    mutate(&mut record.snapshot);
    Ok(())
}

fn set_job_error(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    target_index: Option<usize>,
    message: String,
) -> Result<(), String> {
    update_job(state, job_id, |job| {
        job.error = Some(message.clone());
        job.message = message.clone();
        if let Some(index) = target_index.and_then(|index| job.files.get_mut(index).map(|_| index)) {
            if let Some(file) = job.files.get_mut(index) {
                file.status = "error".to_string();
                file.message = format!("Falha em {}", file.name);
                file.error = Some(message.clone());
            }
        }
        recompute_job_totals(job);
        if job.files.iter().any(|file| file.status == "running" || file.status == "retrying" || file.status == "merging") {
            job.status = "completed_with_errors".to_string();
        } else if job.files.iter().any(|file| file.status == "error") {
            job.status = "completed_with_errors".to_string();
        } else {
            job.status = "error".to_string();
        }
    })?;
    emit_status_from_state(app, state, job_id)?;
    Ok(())
}

fn list_markdown_files(path: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(path).map_err(|error| error.to_string())?;
    let mut files = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();
        if matches!(
            entry_path.extension().and_then(|ext| ext.to_str()),
            Some("md") | Some("markdown")
        ) {
            files.push(entry_path);
        }
    }

    files.sort();
    Ok(files)
}

trait ExpandHome {
    fn expand_home(self) -> PathBuf;
}

impl ExpandHome for PathBuf {
    fn expand_home(self) -> PathBuf {
        if let Some(path) = self.to_str() {
            if let Some(stripped) = path.strip_prefix("~/") {
                if let Some(home) = std::env::var_os("HOME") {
                    return PathBuf::from(home).join(stripped);
                }
            }
        }
        self
    }
}
