#!/bin/bash

# 部署脚本
# 用法: ./deploy.sh [start|stop|restart|logs|update]

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 函数：打印信息
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# 检查 Docker 是否安装
check_docker() {
    if ! command -v docker &> /dev/null; then
        error "Docker 未安装，请先安装 Docker"
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        error "Docker Compose 未安装，请先安装 Docker Compose"
    fi
}

# 检查 .env 文件
check_env() {
    if [ ! -f .env.production ]; then
        warn ".env.production 文件不存在，将从 .env.production.example 复制"
        if [ -f .env.production.example ]; then
            cp .env.production.example .env.production
            warn "请编辑 .env.production 文件配置生产环境变量"
            exit 1
        else
            error ".env.production.example 文件不存在"
        fi
    fi
}

# 启动服务
start() {
    info "启动 PromptGo 服务..."
    check_docker
    check_env

    docker-compose --env-file .env.production up -d

    info "等待服务启动..."
    sleep 5

    docker-compose ps
    info "服务启动完成！"
    info "前端地址: http://localhost"
    info "后端地址: http://localhost:3001"
}

# 停止服务
stop() {
    info "停止 PromptGo 服务..."
    docker-compose down
    info "服务已停止"
}

# 重启服务
restart() {
    info "重启 PromptGo 服务..."
    stop
    start
}

# 查看日志
logs() {
    if [ -z "$2" ]; then
        docker-compose logs -f
    else
        docker-compose logs -f "$2"
    fi
}

# 更新服务
update() {
    info "更新 PromptGo 服务..."

    # 拉取最新代码
    if [ -d .git ]; then
        info "拉取最新代码..."
        git pull
    fi

    # 重新构建镜像
    info "重新构建 Docker 镜像..."
    docker-compose build --no-cache

    # 重启服务
    info "重启服务..."
    docker-compose down
    docker-compose --env-file .env.production up -d

    info "更新完成！"
}

# 查看状态
status() {
    info "服务状态："
    docker-compose ps
}

# 清理
clean() {
    warn "这将删除所有容器、镜像和数据卷（包括数据库数据）"
    read -p "确认要继续吗？(y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        info "清理中..."
        docker-compose down -v
        docker system prune -af
        info "清理完成"
    else
        info "已取消"
    fi
}

# 备份数据库
backup() {
    info "备份 MySQL 数据库..."

    BACKUP_DIR="./backups"
    mkdir -p "$BACKUP_DIR"

    BACKUP_FILE="$BACKUP_DIR/mysql_backup_$(date +%Y%m%d_%H%M%S).sql"

    docker-compose exec -T mysql mysqldump -u root -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" > "$BACKUP_FILE"

    info "备份完成: $BACKUP_FILE"
}

# 主逻辑
case "${1:-help}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    logs)
        logs "$@"
        ;;
    update)
        update
        ;;
    status)
        status
        ;;
    clean)
        clean
        ;;
    backup)
        backup
        ;;
    help|*)
        echo "用法: $0 {start|stop|restart|logs|update|status|backup|clean}"
        echo ""
        echo "命令说明:"
        echo "  start    - 启动所有服务"
        echo "  stop     - 停止所有服务"
        echo "  restart  - 重启所有服务"
        echo "  logs     - 查看日志 (可选: logs [service-name])"
        echo "  update   - 更新并重启服务"
        echo "  status   - 查看服务状态"
        echo "  backup   - 备份数据库"
        echo "  clean    - 清理所有容器和数据"
        exit 1
        ;;
esac
