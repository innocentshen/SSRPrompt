# 多阶段构建 - 前端
FROM node:18-alpine AS frontend-builder

WORKDIR /app

# 复制前端依赖文件
COPY package*.json ./
RUN npm ci

# 复制前端源码
COPY . .

# 构建前端
RUN npm run build

# Nginx 镜像用于提供前端静态文件
FROM nginx:alpine

# 复制构建好的前端文件
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# 复制 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 暴露端口
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
