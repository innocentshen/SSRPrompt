#!/bin/bash

# Supabase 快速配置脚本
# 用法: ./setup-supabase.sh

set -e

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

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

echo "================================================"
echo "   PromptGo Supabase 配置向导"
echo "================================================"
echo ""

# 检查 .env 文件
if [ -f .env ]; then
    warn ".env 文件已存在，将备份为 .env.backup"
    cp .env .env.backup
fi

echo "请按照以下步骤配置 Supabase："
echo ""
echo "1. 访问 https://supabase.com 并登录"
echo "2. 创建新项目或选择现有项目"
echo "3. 进入 Settings > API 获取连接信息"
echo ""

# 获取用户输入
read -p "请输入 Supabase Project URL: " SUPABASE_URL
read -p "请输入 Supabase Anon Key: " SUPABASE_KEY
read -p "设置应用访问密码 (默认: admin123): " APP_PASSWORD

# 使用默认值
APP_PASSWORD=${APP_PASSWORD:-admin123}

# 创建 .env 文件
cat > .env << EOF
# Supabase 配置
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$SUPABASE_KEY

# 应用访问密码
VITE_APP_PASSWORD=$APP_PASSWORD

# MySQL 配置（已禁用，优先使用 Supabase）
# VITE_MYSQL_PROXY_URL=http://localhost:3001/api/mysql-proxy
# VITE_MYSQL_PROXY_API_KEY=your_api_key
EOF

info "环境变量配置完成！"
echo ""

# 询问是否安装 Supabase CLI
read -p "是否安装 Supabase CLI 用于数据库迁移？(y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v brew &> /dev/null; then
        info "使用 Homebrew 安装 Supabase CLI..."
        brew install supabase/tap/supabase
    elif command -v npm &> /dev/null; then
        info "使用 npm 安装 Supabase CLI..."
        npm install -g supabase
    else
        warn "未找到包管理器，请手动安装 Supabase CLI"
        echo "参考: https://supabase.com/docs/guides/cli/getting-started"
    fi
fi

echo ""
info "配置完成！接下来的步骤："
echo ""
echo "1. 执行数据库迁移："
echo "   方式 1（推荐）：使用 Supabase CLI"
echo "     supabase login"
echo "     supabase link --project-ref <your-project-ref>"
echo "     supabase db push"
echo ""
echo "   方式 2：手动执行 SQL"
echo "     在 Supabase Dashboard > SQL Editor 中"
echo "     依次执行 supabase/migrations/ 目录下的 SQL 文件"
echo ""
echo "2. 启动开发服务器："
echo "     npm run dev"
echo ""
echo "3. 访问应用："
echo "     http://localhost:5173"
echo ""
echo "4. 在设置页面测试 Supabase 连接"
echo ""
echo "📖 详细文档: SUPABASE.md"
echo "================================================"
