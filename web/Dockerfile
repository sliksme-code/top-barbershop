FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG SITE_URL=https://top-barbershop.com
ARG SITE_ENV=staging
ENV SITE_URL=$SITE_URL SITE_ENV=$SITE_ENV
RUN npm run build && npm run check:html

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
EXPOSE 4321
HEALTHCHECK CMD wget -qO- http://127.0.0.1:4321/api/health/ || exit 1
CMD ["node", "./dist/server/entry.mjs"]
