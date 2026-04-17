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

#[derive(Clone, Default)]
pub struct AppState {
    jobs: Arc<Mutex<HashMap<String, JobSnapshot>>>,
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

#[derive(Deserialize)]
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

#[derive(Serialize)]
pub struct StartResponse {
    pub job_id: String,
    pub status: String,
    pub message: String,
}

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
    JobCompleted {
        message: String,
        output_paths: Vec<String>,
        progress: f32,
        total_files: usize,
        total_chunks: usize,
    },
    Error {
        message: String,
        output_paths: Vec<String>,
        total_files: usize,
        total_chunks: usize,
        progress: f32,
    },
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
pub fn start_conversion(
    request: ConversionRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<StartResponse, String> {
    if request.inputs.is_empty() {
        return Err("Selecione ao menos uma entrada".to_string());
    }

    if request.output_dir.trim().is_empty() {
        return Err("Selecione uma pasta de saída".to_string());
    }

    let job_id = Uuid::new_v4().to_string();
    let snapshot = JobSnapshot {
        job_id: job_id.clone(),
        status: "queued".to_string(),
        message: "Aguardando o worker iniciar".to_string(),
        progress: 0.0,
        current_file_index: 0,
        total_files: 0,
        current_file_name: None,
        current_chunk_index: 0,
        current_chunk_total: 0,
        completed_chunks: 0,
        total_chunks: 0,
        output_paths: vec![],
        error: None,
    };

    {
        let mut jobs = state.jobs.lock().expect("job store poisoned");
        jobs.insert(job_id.clone(), snapshot.clone());
    }

    emit_status(&app, &snapshot);

    let app_state = state.inner().clone();
    let inputs = request.inputs.clone();
    let output_dir = request.output_dir.clone();
    let model = request.model.clone();
    let voice = request.voice.clone();
    let speaker_wav = request.speaker_wav.clone();
    let max_workers = request.max_workers;
    let start_at = request.start_at;
    let speed = request.speed;

    let spawn_job_id = job_id.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_worker(
            app.clone(),
            app_state.clone(),
            spawn_job_id.clone(),
            inputs,
            output_dir,
            model,
            voice,
            speed,
            speaker_wav,
            start_at,
            max_workers,
        )
        .await
        {
            let _ = set_job_error(&app, &app_state, &spawn_job_id, error);
        }
    });

    Ok(StartResponse {
        job_id,
        status: "queued".to_string(),
        message: "Conversão agendada".to_string(),
    })
}

async fn run_worker(
    app: AppHandle,
    state: AppState,
    job_id: String,
    inputs: Vec<String>,
    output_dir: String,
    model: String,
    voice: Option<String>,
    speed: f32,
    speaker_wav: Option<String>,
    start_at: usize,
    max_workers: Option<usize>,
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
        .arg(output_dir)
        .arg("--model")
        .arg(model)
        .arg("--speed")
        .arg(speed.to_string())
        .arg("--start-at")
        .arg(start_at.to_string())
        .current_dir(&root_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(selected_voice) = voice {
        command.arg("--voice").arg(selected_voice);
    }

    if let Some(reference) = speaker_wav {
        command.arg("--speaker-wav").arg(reference);
    }

    if let Some(workers) = max_workers {
        command.arg("--max-workers").arg(workers.to_string());
    }

    for input in inputs {
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
    emit_status(
        &app,
        &JobSnapshot {
            job_id: job_id.clone(),
            status: "running".to_string(),
            message: format!("Bridge iniciado com {}", python_path.display()),
            progress: 0.0,
            current_file_index: 0,
            total_files: 0,
            current_file_name: None,
            current_chunk_index: 0,
            current_chunk_total: 0,
            completed_chunks: 0,
            total_chunks: 0,
            output_paths: vec![],
            error: None,
        },
    );

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
            let payload = FrontendEvent::Log {
                job_id: stderr_job_id.clone(),
                message: line,
            };
            let _ = stderr_app.emit("tts-event", payload);
        }
    });

    let mut reader = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        handle_bridge_line(&app, &state, &job_id, &line)?;
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
            format!(
                "O processo do bridge terminou com erro.\n\nÚltimos logs:\n{}",
                buffered_stderr
            )
        };
        set_job_error(
            &app,
            &state,
            &job_id,
            detail,
        )?;
    }

    Ok(())
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

fn handle_bridge_line(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    line: &str,
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
                    job.total_files = total_files;
                    job.total_chunks = total_chunks;
                    job.progress = 0.0;
                })?;
            }
            BridgeEvent::FileStarted {
                message,
                file_index,
                total_files,
                file_name,
                chunk_total,
                completed_chunks,
                total_chunks,
            } => {
                update_job(state, job_id, |job| {
                    job.status = "running".to_string();
                    job.message = message.unwrap_or_else(|| format!("Processando {file_name}"));
                    job.current_file_index = file_index;
                    job.total_files = total_files;
                    job.current_file_name = Some(file_name);
                    job.current_chunk_index = 0;
                    job.current_chunk_total = chunk_total;
                    job.completed_chunks = completed_chunks;
                    job.total_chunks = total_chunks;
                    job.progress = if total_chunks > 0 {
                        completed_chunks as f32 / total_chunks as f32
                    } else {
                        0.0
                    };
                })?;
            }
            BridgeEvent::ChunkProgress {
                message,
                file_index,
                total_files,
                file_name,
                chunk_index,
                chunk_total,
                completed_chunks,
                total_chunks,
                _paragraph_end: _,
            } => {
                update_job(state, job_id, |job| {
                    job.status = "running".to_string();
                    job.message = message.clone();
                    job.current_file_index = file_index;
                    job.total_files = total_files;
                    job.current_file_name = Some(file_name);
                    job.current_chunk_index = chunk_index;
                    job.current_chunk_total = chunk_total;
                    job.completed_chunks = completed_chunks;
                    job.total_chunks = total_chunks;
                    job.progress = if total_chunks > 0 {
                        completed_chunks as f32 / total_chunks as f32
                    } else {
                        0.0
                    };
                })?;
            }
            BridgeEvent::FileMerging {
                message,
                file_index,
                total_files,
                file_name,
                completed_chunks,
                total_chunks,
            } => {
                update_job(state, job_id, |job| {
                    job.status = "running".to_string();
                    job.message = message;
                    job.current_file_index = file_index;
                    job.total_files = total_files;
                    job.current_file_name = Some(file_name);
                    job.completed_chunks = completed_chunks;
                    job.total_chunks = total_chunks;
                    job.progress = if total_chunks > 0 {
                        completed_chunks as f32 / total_chunks as f32
                    } else {
                        0.0
                    };
                })?;
            }
            BridgeEvent::FileCompleted {
                message,
                file_index,
                total_files,
                file_name,
                output_path,
                completed_chunks,
                total_chunks,
                progress,
            } => {
                update_job(state, job_id, |job| {
                    job.status = "running".to_string();
                    job.message = message;
                    job.current_file_index = file_index;
                    job.total_files = total_files;
                    job.current_file_name = Some(file_name);
                    job.completed_chunks = completed_chunks;
                    job.total_chunks = total_chunks;
                    job.progress = progress;
                    job.output_paths.push(output_path);
                })?;
            }
            BridgeEvent::JobCompleted {
                message,
                output_paths,
                progress,
                total_files,
                total_chunks,
            } => {
                update_job(state, job_id, |job| {
                    job.status = "completed".to_string();
                    job.message = message;
                    job.progress = progress;
                    job.total_files = total_files;
                    job.total_chunks = total_chunks;
                    job.output_paths = output_paths;
                    job.error = None;
                })?;
            }
            BridgeEvent::Error {
                message,
                output_paths,
                total_files,
                total_chunks,
                progress,
            } => {
                update_job(state, job_id, |job| {
                    job.status = "error".to_string();
                    job.message = message.clone();
                    job.progress = progress;
                    job.total_files = total_files;
                    job.total_chunks = total_chunks;
                    job.output_paths = output_paths;
                    job.error = Some(message);
                })?;
            }
        },
        Err(_) => {
            let payload = FrontendEvent::Log {
                job_id: job_id.to_string(),
                message: line.to_string(),
            };
            let _ = app.emit("tts-event", payload);
            return Ok(());
        }
    }

    emit_status_from_state(app, state, job_id)?;
    Ok(())
}

fn emit_status_from_state(app: &AppHandle, state: &AppState, job_id: &str) -> Result<(), String> {
    let job = {
        let jobs = state.jobs.lock().expect("job store poisoned");
        jobs.get(job_id)
            .cloned()
            .ok_or_else(|| format!("Job não encontrado: {job_id}"))?
    };

    emit_status(app, &job);
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
    let job = jobs
        .get_mut(job_id)
        .ok_or_else(|| format!("Job não encontrado: {job_id}"))?;
    mutate(job);
    Ok(())
}

fn set_job_error(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    message: String,
) -> Result<(), String> {
    update_job(state, job_id, |job| {
        job.status = "error".to_string();
        job.message = message.clone();
        job.error = Some(message.clone());
        job.progress = job.progress.max(0.0);
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
