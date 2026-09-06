FROM node:20-bookworm-slim

# Install system dependencies: FFmpeg, FFprobe, Fonts for ASS rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package descriptors
COPY package*.json ./
RUN npm install

# Copy source and config
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript
RUN npm run build

# Create persistent storage directories
RUN mkdir -p /app/storage/raw \
    /app/storage/layers \
    /app/storage/audio \
    /app/storage/subtitles \
    /app/storage/renders \
    /app/storage/textures

EXPOSE 4100

CMD ["node", "dist/index.js"]
