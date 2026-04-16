use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct VoiceEntry {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Serialize)]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub offline: bool,
    pub supports_speaker_wav: bool,
    pub supports_speed: bool,
    pub default_voice: Option<String>,
    pub voices: Vec<VoiceEntry>,
}

#[derive(Clone, Serialize)]
pub struct Catalog {
    pub default_model: String,
    pub models: Vec<ModelEntry>,
}

pub fn catalog() -> Catalog {
    Catalog {
        default_model: "kokoro".to_string(),
        models: vec![
            ModelEntry {
                id: "kokoro".to_string(),
                name: "Kokoro TTS".to_string(),
                description: "Leve, offline e muito rápido para leitura longa.".to_string(),
                offline: true,
                supports_speaker_wav: false,
                supports_speed: true,
                default_voice: Some("pf_dora".to_string()),
                voices: vec![
                    VoiceEntry {
                        id: "pf_dora".to_string(),
                        label: "Dora".to_string(),
                    },
                    VoiceEntry {
                        id: "pm_alex".to_string(),
                        label: "Alex".to_string(),
                    },
                    VoiceEntry {
                        id: "pm_santa".to_string(),
                        label: "Santa".to_string(),
                    },
                ],
            },
            ModelEntry {
                id: "edge".to_string(),
                name: "Edge TTS".to_string(),
                description: "Voz natural da Microsoft com saída online gratuita.".to_string(),
                offline: false,
                supports_speaker_wav: false,
                supports_speed: false,
                default_voice: Some("pt-BR-FranciscaNeural".to_string()),
                voices: vec![
                    VoiceEntry {
                        id: "pt-BR-FranciscaNeural".to_string(),
                        label: "Francisca".to_string(),
                    },
                    VoiceEntry {
                        id: "pt-BR-BryanNeural".to_string(),
                        label: "Bryan".to_string(),
                    },
                    VoiceEntry {
                        id: "pt-BR-AntonioNeural".to_string(),
                        label: "Antonio".to_string(),
                    },
                ],
            },
            ModelEntry {
                id: "piper".to_string(),
                name: "Piper TTS".to_string(),
                description: "CPU puro, rápido e estável para produção offline.".to_string(),
                offline: true,
                supports_speaker_wav: false,
                supports_speed: false,
                default_voice: Some("pt-pt_tugao-medium".to_string()),
                voices: vec![
                    VoiceEntry {
                        id: "pt-pt_tugao-medium".to_string(),
                        label: "Tugão médio".to_string(),
                    },
                    VoiceEntry {
                        id: "pt-pt_tugao-high".to_string(),
                        label: "Tugão alto".to_string(),
                    },
                ],
            },
            ModelEntry {
                id: "edge-xtts".to_string(),
                name: "Edge + XTTS".to_string(),
                description: "Edge cria a referência e o XTTS faz a clonagem final.".to_string(),
                offline: false,
                supports_speaker_wav: false,
                supports_speed: false,
                default_voice: Some("pt-BR-FranciscaNeural".to_string()),
                voices: vec![
                    VoiceEntry {
                        id: "pt-BR-FranciscaNeural".to_string(),
                        label: "Francisca".to_string(),
                    },
                    VoiceEntry {
                        id: "pt-BR-BryanNeural".to_string(),
                        label: "Bryan".to_string(),
                    },
                    VoiceEntry {
                        id: "pt-BR-AntonioNeural".to_string(),
                        label: "Antonio".to_string(),
                    },
                ],
            },
            ModelEntry {
                id: "xtts".to_string(),
                name: "XTTS v2".to_string(),
                description: "Clonagem de voz via WAV de referência.".to_string(),
                offline: true,
                supports_speaker_wav: true,
                supports_speed: false,
                default_voice: None,
                voices: vec![],
            },
        ],
    }
}
