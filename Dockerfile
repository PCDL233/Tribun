# 多阶段构建（方案 7.2）：单容器同时提供 Hono API 与 Dashboard 静态产物
FROM node:22-alpine AS build
WORKDIR /app

# corepack 按根 package.json 的 packageManager 激活 pnpm 10
RUN corepack enable
# better-sqlite3 为原生模块：无预编译二进制时需要本机工具链回退编译
RUN apk add --no-cache python3 make g++

COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm turbo build --filter=@ai-review/server... --filter=@ai-review/web...

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# pnpm 的 workspace 链接为相对符号链接，整体复制即可保持解析：
# 根 node_modules（.pnpm 实体）+ packages（各包 dist 与 node_modules）+ server/web 产物
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

# SQLite 审查记录落在挂载卷中，容器重建不丢历史
VOLUME ["/app/.ai-review-cache"]
EXPOSE 8080

CMD ["node", "apps/server/dist/main.js", "--port", "8080", "--web-dist", "apps/web/dist"]
