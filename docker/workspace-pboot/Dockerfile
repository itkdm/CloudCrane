FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends -y php-cli git sqlite3 ripgrep curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupmod --new-name workspace node \
  && usermod --login workspace --home /home/workspace --move-home node

WORKDIR /app
COPY . .
RUN npm install --global pnpm@10.11.0 \
  && pnpm install --frozen-lockfile --filter @cloudcrane/workspace-daemon...
RUN pnpm --filter @cloudcrane/workspace-daemon... build

RUN mkdir -p /workspace && chown -R workspace:workspace /workspace
WORKDIR /workspace
ENV NODE_ENV=production
EXPOSE 7070
USER workspace
CMD ["node", "/app/apps/workspace-daemon/dist/index.js"]
