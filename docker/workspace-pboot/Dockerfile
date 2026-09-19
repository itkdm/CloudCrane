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
  && git -C /tmp/pbootcms-base fetch --depth=1 origin 8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea \
  && git -C /tmp/pbootcms-base checkout --detach FETCH_HEAD \
  && rm -rf /tmp/pbootcms-base/.git \
  && mkdir -p /opt/cloudcrane \
  && cp -a /tmp/pbootcms-base /opt/cloudcrane/pbootcms-base \
  && printf 'pbootcms=3.2.26\nsourceCommit=%s\n' '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea' > /opt/cloudcrane/pbootcms-base/.cloudcrane-base

COPY docker/workspace-pboot/cloudcrane-init-pboot /usr/local/bin/cloudcrane-init-pboot
COPY docker/workspace-pboot/cloudcrane-pboot-license /usr/local/bin/cloudcrane-pboot-license
COPY docker/workspace-pboot/cloudcrane-normalize-k714 /usr/local/bin/cloudcrane-normalize-k714
COPY docker/workspace-pboot/cloudcrane-migrate-pboot-sqlite /usr/local/bin/cloudcrane-migrate-pboot-sqlite
COPY docker/workspace-pboot/cloudcrane-rebind-pboot-state /usr/local/bin/cloudcrane-rebind-pboot-state
COPY docker/workspace-pboot/cloudcrane-apply-pboot-snapshot /usr/local/bin/cloudcrane-apply-pboot-snapshot
COPY docker/workspace-pboot/pboot-migrations /opt/cloudcrane/pboot-migrations
COPY docker/workspace-pboot/pboot-releases.json /opt/cloudcrane/pboot-releases.json
COPY docker/workspace-pboot/skills/pboot-template-migration /opt/cloudcrane/skills/pboot-template-migration
COPY docker/workspace-pboot/skills/pbootcms-upgrade /opt/cloudcrane/skills/pbootcms-upgrade
COPY docker/workspace-pboot/skills/template-publish /opt/cloudcrane/skills/template-publish
RUN chmod 0755 /usr/local/bin/cloudcrane-init-pboot /usr/local/bin/cloudcrane-pboot-license /usr/local/bin/cloudcrane-normalize-k714 /usr/local/bin/cloudcrane-migrate-pboot-sqlite /usr/local/bin/cloudcrane-rebind-pboot-state /usr/local/bin/cloudcrane-apply-pboot-snapshot

RUN npm install --global pnpm@10.11.0 \
  && pnpm install --frozen-lockfile --filter @cloudcrane/workspace-daemon...
RUN pnpm --filter @cloudcrane/workspace-daemon... build

RUN mkdir -p /workspace && chown -R workspace:workspace /workspace
WORKDIR /workspace
ENV NODE_ENV=production
EXPOSE 7070 8080
USER workspace
CMD ["node", "/app/apps/workspace-daemon/dist/index.js"]
