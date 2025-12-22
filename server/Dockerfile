# 后端 Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# 复制后端依赖文件
COPY package*.json ./
RUN npm ci

# 复制后端源码
COPY . .

# 构建后端
RUN npm run build

# 生产镜像
FROM node:18-alpine

WORKDIR /app

# 只复制生产依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制构建好的文件
COPY --from=builder /app/dist ./dist

# 暴露端口
EXPOSE 3001

# 启动应用
CMD ["node", "dist/index.js"]
