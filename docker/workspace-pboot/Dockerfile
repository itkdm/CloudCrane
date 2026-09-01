FROM node:22-bookworm-slim

ARG APT_MIRROR=deb.debian.org
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install --no-install-recommends -y php-cli php-curl php-gd php-mbstring php-sqlite3 git sqlite3 ripgrep curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupmod --new-name workspace node \
  && usermod --login workspace --home /home/workspace --move-home node

WORKDIR /app
COPY . .

RUN git init /tmp/pbootcms-base \
  && git -C /tmp/pbootcms-base remote add origin https://github.com/pbootcmspro/PbootCMS.git \
  && git -C /tmp/pbootcms-base fetch --depth=1 origin 29ff72ee5afc9c6553b949f04d3fc99443879f40 \
  && git -C /tmp/pbootcms-base checkout --detach FETCH_HEAD \
  && rm -rf /tmp/pbootcms-base/.git \
  && mkdir -p /opt/cloudcrane \
  && cp -a /tmp/pbootcms-base /opt/cloudcrane/pbootcms-base \
  && printf 'pbootcms=3.2.24\nsourceCommit=%s\n' '29ff72ee5afc9c6553b949f04d3fc99443879f40' > /opt/cloudcrane/pbootcms-base/.cloudcrane-base

COPY docker/workspace-pboot/cloudcrane-init-pboot /usr/local/bin/cloudcrane-init-pboot
COPY docker/workspace-pboot/cloudcrane-pboot-license /usr/local/bin/cloudcrane-pboot-license
COPY docker/workspace-pboot/cloudcrane-normalize-k714 /usr/local/bin/cloudcrane-normalize-k714
RUN chmod 0755 /usr/local/bin/cloudcrane-init-pboot /usr/local/bin/cloudcrane-pboot-license /usr/local/bin/cloudcrane-normalize-k714

RUN npm install --global pnpm@10.11.0 \
  && pnpm install --frozen-lockfile --filter @cloudcrane/workspace-daemon...
RUN pnpm --filter @cloudcrane/workspace-daemon... build

RUN mkdir -p /workspace && chown -R workspace:workspace /workspace
WORKDIR /workspace
ENV NODE_ENV=production
EXPOSE 7070 8080
USER workspace
CMD ["node", "/app/apps/workspace-daemon/dist/index.js"]
