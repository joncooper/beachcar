FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY runner-server.mjs ./

ENV PORT=8788
EXPOSE 8788

CMD ["node", "runner-server.mjs"]
