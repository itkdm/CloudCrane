FROM php:8.4-fpm-alpine

RUN apk add --no-cache nginx curl oniguruma freetype libjpeg-turbo libpng libwebp sqlite-libs \
    && apk add --no-cache --virtual .php-build-deps $PHPIZE_DEPS curl-dev freetype-dev libjpeg-turbo-dev libpng-dev libwebp-dev oniguruma-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j"$(nproc)" curl gd mbstring \
    && php -r 'if (!extension_loaded("SQLite3") || !extension_loaded("pdo_sqlite")) { fwrite(STDERR, "SQLite3 and pdo_sqlite are required\\n"); exit(1); }' \
    && apk del .php-build-deps \
    && addgroup -g 1000 cloudcrane \
    && adduser -D -u 1000 -G cloudcrane -s /sbin/nologin cloudcrane \
    && mkdir -p /tmp/nginx/client_body /tmp/nginx/fastcgi /tmp/nginx/proxy /tmp/nginx/uwsgi /tmp/nginx/scgi \
    && chown -R 1000:1000 /tmp/nginx /var/lib/nginx /var/log/nginx

COPY docker/production-pboot/nginx.conf /etc/nginx/nginx.conf
COPY docker/production-pboot/www.conf /usr/local/etc/php-fpm.d/zz-cloudcrane.conf
COPY docker/production-pboot/health.php /usr/local/lib/cloudcrane-health.php
COPY docker/workspace-pboot/cloudcrane-pboot-license /usr/local/bin/cloudcrane-pboot-license
COPY docker/production-pboot/cloudcrane-pboot-cms /usr/local/bin/cloudcrane-pboot-cms
RUN chmod 0755 /usr/local/bin/cloudcrane-pboot-license /usr/local/bin/cloudcrane-pboot-cms

USER 1000:1000
EXPOSE 8080
CMD ["sh", "-ec", "mkdir -p /tmp/nginx/client_body /tmp/nginx/fastcgi /tmp/nginx/proxy /tmp/nginx/uwsgi /tmp/nginx/scgi; php-fpm -F & exec nginx -e stderr -g 'daemon off;'"]
