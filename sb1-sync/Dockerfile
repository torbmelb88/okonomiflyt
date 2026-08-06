FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Refresh-token (rotert) og output bor her — monter et volum så det overlever restart.
VOLUME ["/app/data"]
ENV SB1_TOKEN_STORE=/app/data/token.json
ENV SB1_OUT_DIR=/app/data

CMD ["node", "src/index.js"]
