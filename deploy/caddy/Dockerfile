# Caddy с плагином replace-response: нужен на время переезда, чтобы проксировать старый WordPress
# и заменять в ответах технический домен на боевой.
FROM caddy:2.10-builder AS build
RUN xcaddy build --with github.com/caddyserver/replace-response
FROM caddy:2.10-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
