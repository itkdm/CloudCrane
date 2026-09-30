FROM php:8.4-fpm-alpine

RUN apk add --no-cache nginx curl oniguruma freetype libjpeg-turbo libpng sqlite-libs \
    && apk add --no-cache --virtual .php-build-deps $PHPIZE_DEPS curl-dev freetype-dev libjpeg-turbo-dev libpng-dev oniguruma-dev sqlite-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" curl gd mbstring pdo_sqlite \
    && apk del .php-build-deps \
    && addgroup -g 1000 cloudcrane \
    && adduser -D -u 1000 -G cloudcrane -s /sbin/nologin cloudcrane \
    && mkdir -p /tmp/nginx/client_body /tmp/nginx/fastcgi /tmp/nginx/proxy /tmp/nginx/uwsgi /tmp/nginx/scgi \
    && chown -R 1000:1000 /tmp/nginx /var/lib/nginx /var/log/nginx

COPY docker/production-pboot/nginx.conf /etc/nginx/nginx.conf
COPY docker/production-pboot/www.conf /usr/local/etc/php-fpm.d/zz-cloudcrane.conf
COPY docker/workspace-pboot/cloudcrane-pboot-license /usr/local/bin/cloudcrane-pboot-license
RUN chmod 0755 /usr/local/bin/cloudcrane-pboot-license

USER 1000:1000
EXPOSE 8080
CMD ["sh", "-ec", "mkdir -p /tmp/nginx/client_body /tmp/nginx/fastcgi /tmp/nginx/proxy /tmp/nginx/uwsgi /tmp/nginx/scgi; php-fpm -F & exec nginx -g 'daemon off;'"]
