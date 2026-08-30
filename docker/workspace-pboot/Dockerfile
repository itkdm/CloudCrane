FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends -y php-cli git sqlite3 ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1000 workspace \
  && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash workspace

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/workspace-daemon/package.json apps/workspace-daemon/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/workspace-protocol/package.json packages/workspace-protocol/package.json
RUN corepack enable && pnpm install --frozen-lockfile --filter @cloudcrane/workspace-daemon...

COPY apps/workspace-daemon apps/workspace-daemon
COPY packages/shared packages/shared
COPY packages/workspace-protocol packages/workspace-protocol
RUN pnpm --filter @cloudcrane/workspace-daemon build

RUN mkdir -p /workspace && chown -R workspace:workspace /workspace
WORKDIR /workspace
ENV NODE_ENV=production
EXPOSE 7070
USER workspace
CMD ["node", "/app/apps/workspace-daemon/dist/index.js"]
