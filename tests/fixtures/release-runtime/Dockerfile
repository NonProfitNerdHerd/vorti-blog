FROM node:22.23.2-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.28.2 --activate
WORKDIR /build
CMD ["tail", "-f", "/dev/null"]
