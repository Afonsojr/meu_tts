# 🎤 Interface Web TTS Audiobook Generator

Interface web completa para converter texto em áudio usando Kokoro TTS, Edge-TTS, ou XTTS v2 com clonagem de voz.

## 🚀 Começando

### 1. Instalar Dependências
```bash
uv sync
```

### 2. Iniciar o Servidor
```bash
uv run server.py
```

O servidor iniciará em: **http://localhost:8000**

## 🎨 Recursos da Interface

### Tela Principal
- **Campo de Texto**: Cole ou digite seu texto
- **Seletor de Modelo**: Escolha entre 3 modelos TTS
- **Configurações de Voz** (Kokoro):
  - Seleção de voz (Dora, Alex, Santa)
  - Controle de velocidade (0.5x - 2.0x)

### Status de Processamento
- **Barra de Progresso**: Acompanha o progresso em tempo real
- **Informações do Job**: ID, status, modelo
- **Botões de Ação**:
  - Baixar áudio gerado
  - Processar novo texto

## 📊 Modelos Disponíveis

### 🚀 Kokoro TTS
- **Tipo**: Offline (não precisa internet)
- **Voz**: Feminina (pf_dora) / Masculino (pm_alex, pm_santa)
- **Velocidade**: Ajustável (0.5x - 2.0x)
- **Tempo**: 2-5 minutos para ~2000 caracteres
- **Qualidade**: Boa
- **Uso**: Melhor para uso local/rápido

### 🌐 Edge-TTS
- **Tipo**: Online (precisa internet)
- **Voz**: Francisca (feminina pt-BR)
- **Tempo**: 30-60 segundos para ~2000 caracteres
- **Qualidade**: Excelente, voz natural
- **Custo**: Gratuito
- **Uso**: Alternativa rápida e grátis

### 🎙️ Edge-TTS + XTTS v2
- **Tipo**: Híbrido (Edge + XTTS local)
- **Voz**: Francisca clonada
- **Tempo**: 3-6 minutos para ~2000 caracteres
- **Qualidade**: Muito alta, voz clonada natural
- **Uso**: Melhor qualidade com características da Francisca

## 🔧 API REST

### Endpoints Disponíveis

#### 1. Converter Texto em Áudio
```bash
POST /api/convert
Content-Type: application/json

{
  "text": "Seu texto aqui",
  "model": "kokoro|edge|edge-xtts",
  "voice": "pf_dora|pm_alex|pm_santa",
  "speed": 1.0
}
```

**Response:**
```json
{
  "job_id": "uuid-string",
  "status": "processing",
  "message": "Conversão iniciada..."
}
```

#### 2. Verificar Status
```bash
GET /api/status/{job_id}
```

**Response:**
```json
{
  "job_id": "uuid-string",
  "status": "processing|completed|error",
  "message": "Gerando áudio com KOKORO...",
  "output_file": "/tmp/path/to/audio.mp3",
  "error": null
}
```

#### 3. Baixar Áudio
```bash
GET /api/download/{job_id}
```

Retorna o arquivo MP3 como download.

#### 4. Obter Lista de Modelos
```bash
GET /api/models
```

**Response:**
```json
{
  "models": [
    {
      "id": "kokoro",
      "name": "Kokoro TTS",
      "description": "Rápido, offline, voz feminina pt-BR",
      "voices": ["pf_dora", "pm_alex", "pm_santa"],
      "supports_speaker_wav": false
    },
    ...
  ]
}
```

#### 5. Limpar Job
```bash
DELETE /api/cleanup/{job_id}
```

Remove os dados do job do servidor.

## 📱 Usando a Interface

### Passo a Passo

1. **Digite seu texto** na caixa de texto principal
2. **Selecione o modelo TTS**:
   - Kokoro: Rápido, offline
   - Edge-TTS: Grátis, online, voz natural
   - Edge-TTS + XTTS: Melhor qualidade, clonagem
3. **Configure voz e velocidade** (se Kokoro)
4. **Clique em "Converter para Áudio"**
5. **Acompanhe o progresso** na seção de status
6. **Baixe o áudio** quando pronto

### Dicas

- Textos menores (100-500 caracteres) são processados mais rápido
- Use Edge-TTS para respostas rápidas
- Use Edge-TTS + XTTS para melhor qualidade
- Use Kokoro se preferir não usar internet
- A velocidade do processamento depende do tamanho do texto

## 🔄 Fluxo de Processamento

```
Texto → Limpeza Markdown → Divisão em Chunks →
Síntese TTS → Merge de áudio → MP3 com metadata → Download
```

## 🐳 Docker (Opcional)

```bash
docker-compose up
```

Acesse em: http://localhost:8000

## 📝 Estrutura de Arquivos

```
meu-projeto-tts/
├── server.py                 # Servidor FastAPI principal
├── templates/
│   └── index.html           # Interface HTML
├── static/
│   ├── style.css            # Estilos CSS
│   └── script.js            # JavaScript frontend
├── generate_audio.py        # Geração de áudio (Kokoro/Edge/XTTS)
├── merge_audio.py           # Merge de chunks em MP3
├── md_to_text.py            # Limpeza de markdown
├── chunker.py               # Divisão de texto
├── config.py                # Configurações dos modelos
└── main.py                  # CLI (alternativa à interface)
```

## ⚙️ Configurações Avançadas

Editar `config.py` para ajustar:

- Tamanho máximo de chunks
- Tamanho de silêncio entre chunks
- Bitrate do MP3 final
- Modelos TTS específicos
- Configurações de voz

## 🐛 Troubleshooting

### "Modelo não encontrado"
- Certifique-se de que `uv sync` foi executado
- Para XTTS: `uv sync --extra xtts`
- Para Edge: `uv sync --extra edge`

### "Erro de conexão com Edge-TTS"
- Verifique sua conexão internet
- Edge-TTS requer internet para funcionar

### "Memória insuficiente"
- Use Kokoro em vez de XTTS
- Reduza o tamanho do texto
- Reinicie o servidor

### "Arquivo muito lento para gerar"
- Use Edge-TTS (mais rápido)
- Reduza o tamanho do texto
- XTTS é mais lento (clonagem requer mais processamento)

## 📊 Performance Típica

| Modelo | Tamanho | Tempo | Arquivo |
|--------|---------|-------|---------|
| Kokoro | 2000 car | 3-5 min | 2.0 MB |
| Edge-TTS | 2000 car | 30-60 s | 2.2 MB |
| Edge+XTTS | 2000 car | 4-6 min | 2.9 MB |

## 🎯 Próximos Passos

- [ ] Suporte para upload de áudio (speaker_wav)
- [ ] Histórico de conversões
- [ ] Configurações por usuário
- [ ] Autenticação e controle de acesso
- [ ] Fila de processamento para múltiplas requisições

## 📄 Licença

MIT

## 🤝 Suporte

Para problemas ou sugestões, abra uma issue no GitHub.

---

**Feito com ❤️ para gerar audiobooks incríveis**
