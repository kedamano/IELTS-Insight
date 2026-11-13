# Changelog

本项目所有重要变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- 听力模拟卷（`kind=mock_test`）：4 section × 40 题完整卷，与短练共用 `?kind=` 筛选；
  首套 `li_mock_campus_01`（校园与学习，40 题 / 90 句 / 1100 词）
- CI/CD：GitHub Actions 工作流（push/PR 自动跑三道门 + 安全扫描 + 内容校验）
- 发布自动化：tag 推送触发构建 + 自动创建 GitHub Release
- Pre-commit hooks：代码格式化（ruff + prettier）、密钥扫描、大文件检查
- 覆盖率配置：后端 pytest coverage（`pyproject.toml`）
- 安全配置：bandit 扫描配置（`.bandit`）
- 代码风格：ruff.toml（Python linter/formatter）、.eslintrc.yml（前端参考）
- 开发文档：`DEVELOPMENT.md`（快速上手 + 代码风格 + 常见任务）

### 改进
- 生成预算按模块放大：listening/reading 的 `max_tokens` 提到 30000（推理型端点的
  隐藏思考会先吃掉预算，8000 必然截断 JSON —— 实测 §17.5 同款）
- 生成失败时 `report`（含 `rejected` 逐条原因）落库，界面不再只有一句「没有生成出任何合格的题目」

### 修复
- 待补充

## [2.0.0] - 2026-11-08

### 新增
- 1 对 1 口语陪练（Wave 8）：6 → 10 个原创场景，A2–B2 分档
- 题库生成端点转正（契约 §17）：设置页一键扩题
- 数据备份与恢复：本机快照、回收站、草稿双写
- 报告屏 Bento 化：综合 Band、逐周柱状、分项 Band 四维
- 靛蓝主题：全 app 统一设计 token

### 改进
- 全 app 磁贴语言推广到九屏
- 异步批改队列：支持离开当前屏、刷新接回
- 存储只读降级：库损坏时不崩，写请求明确拒绝

### 修复
- STT 成功路径漏 `import math`（长期坏的功能）
- 刷新后陪练会话丢失（view/mode/sessionId 三段持久化）
- clash-verge `NO_PROXY=[::1]` 导致 AI 调用全部失败
- 设置页两处偶发红灯（助手 GET 回填）

## [1.5.0] - 2025-07-17

### 新增
- 单词弹窗/句子解析/影子跟读/设置页面

## [1.1.0] - 2025-07-15

### 新增
- 按新设计文档全面升级

## [1.0.0] - 2025-07-15

### 新增
- 初始版本：AI 英语学习对话桌面应用
