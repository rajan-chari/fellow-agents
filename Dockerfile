FROM node:22-bookworm-slim

# Install Python, git, curl, unzip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip git curl unzip ca-certificates sudo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone fresh from GitHub (override with --build-arg)
ARG REPO=https://github.com/rajan-chari/fellow-agents.git
ARG REF=main
RUN git clone --branch $REF --single-branch $REPO /app

# Expose pty-win (3700) and emcom-server (8800)
EXPOSE 3700 8800

# Start services — setup.sh downloads binaries, starts emcom-server + pty-win, waits
CMD ["./setup.sh"]
