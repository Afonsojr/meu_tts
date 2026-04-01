FROM python:3.10-slim

# evitar prompt interativo
ENV DEBIAN_FRONTEND=noninteractive

# deps do sistema
RUN apt-get update && apt-get install -y \
    ffmpeg \
    espeak-ng \
    libsndfile1 \
    git \
    && rm -rf /var/lib/apt/lists/*

# diretório de trabalho
WORKDIR /app

# copiar dependências primeiro (cache)
COPY requirements.txt .

# instalar PyTorch CPU + deps
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    torch torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# copiar código
COPY . .

# comando padrão
CMD ["python", "main.py"]
