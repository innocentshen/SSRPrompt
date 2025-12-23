# SSRPrompt 服务器部署指南

本指南将帮助你在 Ubuntu/Debian 服务器上使用 Docker 部署 SSRPrompt 项目。

## 目录

- [前置要求](#前置要求)
- [服务器准备](#服务器准备)
- [部署步骤](#部署步骤)
- [配置说明](#配置说明)
- [启动服务](#启动服务)
- [常用操作](#常用操作)
- [HTTPS 配置](#https-配置)
- [监控和维护](#监控和维护)
- [故障排查](#故障排查)

## 前置要求

- Ubuntu 20.04+ 或 Debian 11+ 服务器
- 至少 2GB RAM
- 至少 20GB 可用磁盘空间
- 具有 sudo 权限的用户账户
- 服务器开放端口：80、443、3001、3306（可选）

## 服务器准备

### 1. 安装 Docker

```bash
# 更新系统包
sudo apt update && sudo apt upgrade -y

# 安装必要的依赖
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common

# 添加 Docker 官方 GPG 密钥
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# 添加 Docker 仓库
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io

# 启动 Docker 服务
sudo systemctl start docker
sudo systemctl enable docker

# 验证安装
sudo docker --version
```

### 2. 安装 Docker Compose

```bash
# 下载 Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# 添加执行权限
sudo chmod +x /usr/local/bin/docker-compose

# 验证安装
docker-compose --version
```

### 3. 配置 Docker（可选但推荐）

```bash
# 将当前用户添加到 docker 组，避免每次使用 sudo
sudo usermod -aG docker $USER

# 重新登录以使组变更生效
newgrp docker
```

## 部署步骤

### 1. 克隆项目到服务器

```bash
# 如果使用 Git
git clone <你的仓库地址> /opt/promptgo
cd /opt/promptgo

# 或者使用 scp 上传项目文件
# 本地执行: scp -r /path/to/project user@server:/opt/promptgo
```

### 2. 配置环境变量

```bash
cd /opt/promptgo

# 复制环境变量示例文件
cp .env.production.example .env.production

# 编辑环境变量
nano .env.production
```

修改以下配置（**非常重要**）：

```env
# MySQL 数据库密码 - 必须修改为强密码
MYSQL_ROOT_PASSWORD=使用强随机密码替换这里
MYSQL_PASSWORD=使用强随机密码替换这里

# 应用访问密码 - 必须修改
VITE_APP_PASSWORD=你的管理员密码

# API 密钥 - 必须修改为随机字符串
API_KEY=生成一个强随机字符串
```

生成强随机密码的方法：

```bash
# 生成随机密码
openssl rand -base64 32
```

### 3. 赋予部署脚本执行权限

```bash
chmod +x deploy.sh
```

### 4. 修改数据库初始化脚本（可选）

如果你需要自定义数据库结构：

```bash
nano init.sql
```

## 启动服务

### 首次启动

```bash
# 使用部署脚本启动
./deploy.sh start
```

这将会：
1. 拉取必要的 Docker 镜像
2. 构建前端和后端 Docker 镜像
3. 启动 MySQL、后端和前端服务
4. 初始化数据库

### 验证服务状态

```bash
# 查看服务状态
./deploy.sh status

# 或使用 docker-compose
docker-compose ps

# 查看日志
./deploy.sh logs

# 查看特定服务日志
./deploy.sh logs frontend
./deploy.sh logs backend
./deploy.sh logs mysql
```

### 访问应用

打开浏览器访问：
- **前端应用**：`http://your-server-ip`
- **后端 API**：`http://your-server-ip:3001`

使用你在 `.env.production` 中设置的密码登录。

## 常用操作

### 停止服务

```bash
./deploy.sh stop
```

### 重启服务

```bash
./deploy.sh restart
```

### 查看日志

```bash
# 查看所有日志
./deploy.sh logs

# 查看特定服务日志
./deploy.sh logs backend

# 实时查看日志
docker-compose logs -f
```

### 更新应用

当你有��代码需要部署时：

```bash
# 拉取最新代码并重新部署
./deploy.sh update
```

### 备份数据库

```bash
# 备份数据库
./deploy.sh backup

# 备份文件保存在 ./backups/ 目录
```

### 恢复数据库

```bash
# 恢复数据库
docker-compose exec -T mysql mysql -u root -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" < ./backups/your_backup.sql
```

## HTTPS 配置

### 方案 1：使用 Let's Encrypt（推荐）

1. 安装 Certbot：

```bash
sudo apt install certbot
```

2. 停止当前服务：

```bash
./deploy.sh stop
```

3. 获取 SSL 证书：

```bash
sudo certbot certonly --standalone -d your-domain.com
```

4. 创建 SSL 目录并复制证书：

```bash
mkdir -p ssl
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ssl/key.pem
sudo chown $USER:$USER ssl/*.pem
```

5. 修改 nginx.conf，取消 HTTPS 相关注释

6. 重启服务：

```bash
./deploy.sh start
```

7. 设置自动续期：

```bash
sudo crontab -e

# 添加以下行（每月 1 号凌晨 2 点续期）
0 2 1 * * certbot renew --quiet && cp /etc/letsencrypt/live/your-domain.com/*.pem /opt/promptgo/ssl/ && docker-compose restart frontend
```

### 方案 2：使用自签名证书（仅用于测试）

```bash
mkdir -p ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/key.pem -out ssl/cert.pem
```

## 配置说明

### 环境变量详解

| 变量名 | 说明 | 默认值 | 是否必须修改 |
|--------|------|--------|--------------|
| `MYSQL_ROOT_PASSWORD` | MySQL root 密码 | - | ✅ 必须 |
| `MYSQL_DATABASE` | 数据库名称 | promptgo | 可选 |
| `MYSQL_USER` | MySQL 用户名 | promptgo_user | 可选 |
| `MYSQL_PASSWORD` | MySQL 用户密码 | - | ✅ 必须 |
| `VITE_APP_PASSWORD` | 应用访问密码 | admin123 | ✅ 必须 |
| `API_KEY` | 后端 API 密钥 | - | ✅ 必须 |

### 端口配置

默认端口映射：
- `80` → 前端 HTTP
- `443` → 前端 HTTPS（如果配置）
- `3001` → 后端 API
- `3306` → MySQL（可以移除端口映射提高安全性）

如需修改端口，编辑 `docker-compose.yml`：

```yaml
services:
  frontend:
    ports:
      - "8080:80"  # 将前端改为 8080 端口
```

### 防火墙配置

```bash
# 如果使用 UFW
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3001/tcp  # 如果需要外部访问 API
sudo ufw enable
```

## 监控和维护

### 查看资源使用情况

```bash
# 查看容器资源使用
docker stats

# 查看磁盘使用
docker system df
```

### 清理不用的镜像和容器

```bash
# 清理悬挂镜像
docker image prune -a

# 清理所有未使用的资源
docker system prune -a
```

### 日志轮转

Docker 默认不限制日志大小，建议配置日志轮转。

编辑 `/etc/docker/daemon.json`：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

重启 Docker：

```bash
sudo systemctl restart docker
```

### 设置开机自启动

```bash
# Docker 服务已设置开机自启
# 确保容器也自动重启
docker-compose up -d --restart=always
```

## 故障排查

### 服务无法启动

1. 查看日志：
```bash
./deploy.sh logs
```

2. 检查端口占用：
```bash
sudo netstat -tlnp | grep -E '80|443|3001|3306'
```

3. 检查 Docker 服务状态：
```bash
sudo systemctl status docker
```

### 数据库连接失败

1. 检查 MySQL 容器是否运行：
```bash
docker-compose ps mysql
```

2. 检查数据库连接：
```bash
docker-compose exec mysql mysql -u root -p
```

3. 查看 MySQL 日志：
```bash
docker-compose logs mysql
```

### 前端无法访问后端

1. 检查网络配置：
```bash
docker network ls
docker network inspect promptgo_promptgo-network
```

2. 测试后端健康检查：
```bash
curl http://localhost:3001/health
```

### 容器内存不足

修改 `docker-compose.yml` 添加资源限制：

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### 权限问题

```bash
# 确保当前用户在 docker 组中
groups $USER

# 如果不在，添加到 docker 组
sudo usermod -aG docker $USER
newgrp docker
```

## 性能优化

### 1. 启用 Nginx 缓存

在 `nginx.conf` 中添加：

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m max_size=100m;

location /api/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 5m;
    # ... 其他配置
}
```

### 2. 优化 MySQL

创建 `mysql.cnf`：

```ini
[mysqld]
max_connections = 200
innodb_buffer_pool_size = 512M
innodb_log_file_size = 128M
```

在 `docker-compose.yml` 中挂载：

```yaml
services:
  mysql:
    volumes:
      - ./mysql.cnf:/etc/mysql/conf.d/custom.cnf:ro
```

## 安全建议

1. ✅ 修改所有默认密码
2. ✅ 使用强随机密码和 API Key
3. ✅ 启用 HTTPS
4. ✅ 定期备份数据库
5. ✅ 定期更新系统和 Docker 镜像
6. ✅ 配置防火墙，只开放必要端口
7. ✅ 考虑关闭 MySQL 的外部端口（移除 3306 端口映射）
8. ✅ 定期审计日志

## 生产环境清单

部署前检查：

- [ ] 已修改所有默认密码
- [ ] 已配置 HTTPS 证书
- [ ] 已设置防火墙规则
- [ ] 已配置自动备份
- [ ] 已设置日志轮转
- [ ] 已测试服务可访问
- [ ] 已配置监控告警（可选）
- [ ] 已准备回滚方案

## 获取帮助

如遇到问题，请：
1. 查看日志：`./deploy.sh logs`
2. 检查服务状态：`./deploy.sh status`
3. 查阅本文档的故障排查部分
4. 提交 Issue 到项目仓库

## 卸载

如需完全卸载：

```bash
# 停止并删除所有容器和数据
./deploy.sh clean

# 或手动执行
docker-compose down -v
docker system prune -af
```

**警告**：这将删除所有数据，包括数据库！请先备份！
