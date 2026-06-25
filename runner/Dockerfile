FROM oven/bun:1.3.2-slim

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY runner-server.mjs ./

ENV PORT=8788
EXPOSE 8788

CMD ["bun", "runner-server.mjs"]
