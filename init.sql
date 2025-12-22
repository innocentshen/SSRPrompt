-- PromptGo 数据库初始化脚本
-- 请根据你的需求修改表结构

CREATE DATABASE IF NOT EXISTS promptgo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE promptgo;

-- 示例表：Prompts 表
CREATE TABLE IF NOT EXISTS prompts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 示例表：评测记录表
CREATE TABLE IF NOT EXISTS evaluations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    prompt_id INT NOT NULL,
    test_case TEXT NOT NULL,
    result TEXT,
    score DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_prompt_id (prompt_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 示例表：执行历史表
CREATE TABLE IF NOT EXISTS traces (
    id INT AUTO_INCREMENT PRIMARY KEY,
    prompt_id INT NOT NULL,
    input TEXT NOT NULL,
    output TEXT,
    duration_ms INT,
    status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_prompt_id (prompt_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 插入示例数据（可选）
INSERT INTO prompts (title, content, description) VALUES
('示例 Prompt', '你是一个有用的助手。', '这是一个示例 prompt'),
('翻译助手', '请将以下内容翻译成英文：', '用于中英文翻译的 prompt');
