@echo off
REM Supabase 快速配置脚本 (Windows)
REM 用法: setup-supabase.bat

setlocal EnableDelayedExpansion

echo ================================================
echo    PromptGo Supabase 配置向导
echo ================================================
echo.

REM 检查 .env 文件
if exist .env (
    echo [WARN] .env 文件已存在，将备份为 .env.backup
    copy /Y .env .env.backup >nul
)

echo 请按照以下步骤配置 Supabase：
echo.
echo 1. 访问 https://supabase.com 并登录
echo 2. 创建新项目或选择现有项目
echo 3. 进入 Settings ^> API 获取连接信息
echo.

REM 获取用户输入
set /p SUPABASE_URL="请输入 Supabase Project URL: "
set /p SUPABASE_KEY="请输入 Supabase Anon Key: "
set /p APP_PASSWORD="设置应用访问密码 (默认: admin123): "

REM 使用默认值
if "%APP_PASSWORD%"=="" set APP_PASSWORD=admin123

REM 创建 .env 文件
(
echo # Supabase 配置
echo VITE_SUPABASE_URL=%SUPABASE_URL%
echo VITE_SUPABASE_ANON_KEY=%SUPABASE_KEY%
echo.
echo # 应用访问密码
echo VITE_APP_PASSWORD=%APP_PASSWORD%
echo.
echo # MySQL 配置^(已禁用，优先使用 Supabase^)
echo # VITE_MYSQL_PROXY_URL=http://localhost:3001/api/mysql-proxy
echo # VITE_MYSQL_PROXY_API_KEY=your_api_key
) > .env

echo [INFO] 环境变量配置完成！
echo.

REM 询问是否安装 Supabase CLI
set /p INSTALL_CLI="是否安装 Supabase CLI 用于数据库迁移？(y/N): "

if /i "%INSTALL_CLI%"=="y" (
    where scoop >nul 2>&1
    if !errorlevel! equ 0 (
        echo [INFO] 使用 Scoop 安装 Supabase CLI...
        scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
        scoop install supabase
    ) else (
        where npm >nul 2>&1
        if !errorlevel! equ 0 (
            echo [INFO] 使用 npm 安装 Supabase CLI...
            npm install -g supabase
        ) else (
            echo [WARN] 未找到包管理器，请手动安装 Supabase CLI
            echo 参考: https://supabase.com/docs/guides/cli/getting-started
        )
    )
)

echo.
echo [INFO] 配置完成！接下来的步骤：
echo.
echo 1. 执行数据库迁移：
echo    方式 1^(推荐^)：使用 Supabase CLI
echo      supabase login
echo      supabase link --project-ref ^<your-project-ref^>
echo      supabase db push
echo.
echo    方式 2：手动执行 SQL
echo      在 Supabase Dashboard ^> SQL Editor 中
echo      依次执行 supabase/migrations/ 目录下的 SQL 文件
echo.
echo 2. 启动开发服务器：
echo      npm run dev
echo.
echo 3. 访问应用：
echo      http://localhost:5173
echo.
echo 4. 在设置页面测试 Supabase 连接
echo.
echo 📖 详细文档: SUPABASE.md
echo ================================================

pause
