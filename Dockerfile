FROM oven/bun:1.3.5 AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY src ./src
RUN bun run build

FROM oven/bun:1.3.5

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY --from=build /app/dist ./dist
COPY --from=build /app/src/yt-dlp ./src/yt-dlp

CMD ["bun", "run", "start"]
