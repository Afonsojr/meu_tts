// ============================================================
// Configuração e Estado Global
// ============================================================

const state = {
    currentJobId: null,
    isProcessing: false,
};

// ============================================================
// Seletores de Elementos
// ============================================================

const elements = {
    // Form
    textInput: document.getElementById("text-input"),
    charCount: document.querySelector(".char-count"),
    modelRadios: document.querySelectorAll('input[name="model"]'),
    voiceSelect: document.getElementById("voice-select"),
    speedInput: document.getElementById("speed-input"),
    speedValue: document.getElementById("speed-value"),
    convertBtn: document.getElementById("convert-btn"),

    // Status
    statusSection: document.getElementById("status-section"),
    statusIndicator: document.getElementById("status-indicator"),
    statusMessage: document.getElementById("status-message"),
    statusDetails: document.getElementById("status-details"),
    jobIdSpan: document.getElementById("job-id"),
    statusText: document.getElementById("status-text"),
    modelText: document.getElementById("model-text"),
    progressFill: document.getElementById("progress-fill"),

    // Action Buttons
    actionButtons: document.getElementById("action-buttons"),
    downloadBtn: document.getElementById("download-btn"),
    resetBtn: document.getElementById("reset-btn"),
    errorBox: document.getElementById("error-box"),
};

// ============================================================
// State de Modelos
// ============================================================

let modelsData = {};

// ============================================================
// Event Listeners
// ============================================================

// Atualizar contador de caracteres
elements.textInput.addEventListener("input", () => {
    const count = elements.textInput.value.length;
    elements.charCount.textContent = `${count} caracteres`;
});

// Atualizar opções quando modelo muda
elements.modelRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
        updateVoiceAndSpeedOptions(e.target.value);
    });
});

// Atualizar valor de velocidade
elements.speedInput.addEventListener("input", (e) => {
    elements.speedValue.textContent = e.target.value + "x";
});

// Converter para áudio
elements.convertBtn.addEventListener("click", handleConvert);

// Download de áudio
elements.downloadBtn.addEventListener("click", handleDownload);

// Reset
elements.resetBtn.addEventListener("click", handleReset);

// ============================================================
// Handlers de Eventos
// ============================================================

async function handleConvert() {
    // Validar entrada
    const text = elements.textInput.value.trim();
    if (!text) {
        showError("Por favor, digite algum texto");
        return;
    }

    if (text.length < 10) {
        showError("Por favor, digite pelo menos 10 caracteres");
        return;
    }

    // Obter valores do formulário
    const model = document.querySelector('input[name="model"]:checked').value;
    const voice = elements.voiceSelect.value;
    const speed = parseFloat(elements.speedInput.value);

    // Desabilitar botão
    elements.convertBtn.disabled = true;
    state.isProcessing = true;

    try {
        // Enviar requisição
        const response = await fetch("/api/convert", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                text,
                model,
                voice,
                speed,
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || "Erro ao iniciar conversão");
        }

        const data = await response.json();
        state.currentJobId = data.job_id;

        // Mostrar seção de status
        elements.statusSection.style.display = "block";
        elements.actionButtons.style.display = "none";
        hideError();

        // Atualizar informações
        elements.jobIdSpan.textContent = state.currentJobId.slice(0, 8);
        elements.modelText.textContent = model.toUpperCase();

        // Iniciar polling de status
        pollStatus();
    } catch (error) {
        showError(`Erro: ${error.message}`);
        elements.convertBtn.disabled = false;
        state.isProcessing = false;
    }
}

async function pollStatus() {
    if (!state.currentJobId || !state.isProcessing) return;

    try {
        const response = await fetch(`/api/status/${state.currentJobId}`);
        if (!response.ok) {
            throw new Error("Erro ao buscar status");
        }

        const job = await response.json();

        // Atualizar UI
        updateStatusUI(job);

        // Continuar polling se ainda está processando
        if (job.status === "processing") {
            setTimeout(pollStatus, 1000); // Polling a cada 1 segundo
        } else if (job.status === "completed") {
            state.isProcessing = false;
            showActionButtons();
            elements.convertBtn.disabled = false;
        } else if (job.status === "error") {
            state.isProcessing = false;
            showError(job.error);
            elements.convertBtn.disabled = false;
        }
    } catch (error) {
        console.error("Erro ao fazer polling:", error);
        setTimeout(pollStatus, 2000); // Retry em 2 segundos
    }
}

async function handleDownload() {
    if (!state.currentJobId) {
        showError("Nenhum áudio para baixar");
        return;
    }

    try {
        const response = await fetch(`/api/download/${state.currentJobId}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || "Erro ao baixar áudio");
        }

        // Criar blob e download
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audiobook_${state.currentJobId.slice(0, 8)}.mp3`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (error) {
        showError(`Erro ao baixar: ${error.message}`);
    }
}

async function handleReset() {
    // Limpar job no servidor
    if (state.currentJobId) {
        try {
            await fetch(`/api/cleanup/${state.currentJobId}`, {
                method: "DELETE",
            });
        } catch (error) {
            console.error("Erro ao limpar job:", error);
        }
    }

    // Reset estado
    state.currentJobId = null;
    state.isProcessing = false;
    elements.textInput.value = "";
    elements.charCount.textContent = "0 caracteres";
    elements.statusSection.style.display = "none";
    elements.actionButtons.style.display = "none";
    elements.convertBtn.disabled = false;
    hideError();

    // Scroll para o topo
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================
// Funções de UI
// ============================================================

function updateStatusUI(job) {
    // Atualizar status badge
    const badge = elements.statusIndicator;
    badge.textContent = getStatusLabel(job.status);
    badge.className = `status-badge status-${job.status}`;

    // Atualizar mensagem
    elements.statusMessage.textContent = job.message || "Processando...";

    // Atualizar status text
    elements.statusText.textContent = getStatusLabel(job.status);

    // Atualizar progress bar
    const progress = getProgress(job.status);
    elements.progressFill.style.width = progress + "%";

    // Mostrar erro se houver
    if (job.error) {
        showError(job.error);
    }
}

function getStatusLabel(status) {
    const labels = {
        pending: "Aguardando...",
        processing: "Processando... ⏳",
        completed: "Concluído ✓",
        error: "Erro ✗",
    };
    return labels[status] || status;
}

function getProgress(status) {
    const progress = {
        pending: 10,
        processing: 50,
        completed: 100,
        error: 100,
    };
    return progress[status] || 0;
}

function showActionButtons() {
    elements.actionButtons.style.display = "flex";
}

function showError(message) {
    elements.errorBox.textContent = message;
    elements.errorBox.style.display = "block";
}

function hideError() {
    elements.errorBox.style.display = "none";
}

// ============================================================
// Funções de Carregamento
// ============================================================

async function loadModels() {
    try {
        const response = await fetch("/api/models");
        if (!response.ok) throw new Error("Erro ao carregar modelos");

        const data = await response.json();
        modelsData = {};

        // Armazenar dados dos modelos
        data.models.forEach((model) => {
            modelsData[model.id] = model;
        });

        // Inicializar opções do modelo padrão (kokoro)
        updateVoiceAndSpeedOptions("kokoro");
    } catch (error) {
        console.error("Erro ao carregar modelos:", error);
    }
}

function updateVoiceAndSpeedOptions(modelId) {
    const model = modelsData[modelId];
    if (!model) return;

    const voiceContainer = document.getElementById("voice-container");
    const speedContainer = document.getElementById("speed-container");
    const voiceSelect = elements.voiceSelect;

    // Limpar select de voz
    voiceSelect.innerHTML = "";

    // Atualizar select de voz baseado no modelo
    if (Object.keys(model.voices).length > 0) {
        voiceContainer.style.display = "block";

        Object.entries(model.voices).forEach(([voiceId, voiceName]) => {
            const option = document.createElement("option");
            option.value = voiceId;
            option.textContent = voiceName;
            voiceSelect.appendChild(option);
        });
    } else {
        voiceContainer.style.display = "none";
    }

    // Mostrar/ocultar velocidade (só para Kokoro)
    if (modelId === "kokoro") {
        speedContainer.style.display = "block";
    } else {
        speedContainer.style.display = "none";
    }
}

// ============================================================
// Inicialização
// ============================================================

// Carregar modelos ao inicializar
loadModels();

// Log de inicialização
console.log("🎤 TTS Audiobook Generator interface loaded");
