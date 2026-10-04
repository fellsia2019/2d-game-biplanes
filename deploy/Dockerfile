FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5187 BIPLANES_DATA=/data/profiles.json
USER node
EXPOSE 5187
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
