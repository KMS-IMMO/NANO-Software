# NANO als geschützte Webseite: Oberfläche bauen und zusammen mit dem NANO-Server ausliefern.
# Build-Kontext ist das Hauptverzeichnis des Projekts (siehe docker-compose.yml).
FROM node:22-alpine AS oberflaeche
WORKDIR /bau
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:web

FROM node:22-alpine
WORKDIR /app
COPY server/nano-server.mjs .
COPY --from=oberflaeche /bau/dist ./web
ENV NANO_DATEN=/daten NANO_WEB=/app/web PORT=8080 NODE_NO_WARNINGS=1
VOLUME /daten
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/info || exit 1
CMD ["node", "nano-server.mjs"]
