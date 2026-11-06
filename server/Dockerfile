FROM node:22-alpine
WORKDIR /app
COPY nano-server.mjs .
ENV NANO_DATEN=/daten PORT=8080 NODE_NO_WARNINGS=1
VOLUME /daten
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/info || exit 1
CMD ["node", "nano-server.mjs"]
