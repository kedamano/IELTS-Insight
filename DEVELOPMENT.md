# 开发指南

本文档面向贡献者，快速上手 IELTS Insight 项目。

## 环境准备

| 工具 | 版本 | 说明 |
|------|------|------|
| Python | 3.13+ | 后端运行时 |
| Node.js | 22+ | 前端构建 |
| Rust | 稳定版 | Tauri 桌面壳（仅打包需要） |
| Git | 2.30+ | 版本控制 |

## 快速开始

```bash
# 1. 克隆仓库
git clone git@github.com:kedamano/IELTS-Insight.git
cd IELTS-Insight

# 2. 后端环境
cd backend
py -3.13 -m venv venv
./venv/Scripts/pip install -r requirements.txt -r requirements-dev.txt

# 3. 前端环境
cd ../frontend
npm install

# 4. 配置 AI 端点（可选）
cp ../.env.example .env
# 编辑 backend/.env，填入 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL

# 5. 启动开发服务
cd .. && powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
```

浏览器打开 http://localhost:5173 即可开发调试。

## 质量门

```bash
# 完整检查（类型 + 前端测试 + 后端测试）
bash scripts/check.sh

# 仅前端
cd frontend && npx tsc -b && npm test

# 仅后端
cd backend && ./venv/Scripts/python.exe -m pytest

# 内容校验
cd backend && ./venv/Scripts/python.exe tools/validate_ielts_data.py

# 版本一致性
powershell -ExecutionPolicy Bypass -File scripts/version-check.ps1
```

## 代码风格

### Python
- Linter: [Ruff](https://docs.astral.sh/ruff/) (`ruff.toml`)
- 命名: `snake_case` 函数/变量，`PascalCase` 类
- 导入: isort 排序，标准库 → 第三方 → 本地
- 类型注解: 公共函数必须有

### TypeScript / React
- 无 ESLint（现有代码库），但 `.eslintrc.yml` 可供新代码参考
- 组件: `PascalCase`，文件同名
- Hooks: `use` 前缀
- 类型: `interface` 优先，复杂联合用 `type`

## 项目结构

```
backend/app/
  api/          # FastAPI 路由（按模块拆分）
  services/     # 业务逻辑（评分、会话、AI 客户端等）
  db/           # SQLite 存储层
  prompts/      # AI 提示词模板
  data/ielts/   # 题库 JSON（原创内容）

frontend/src/
  features/     # 九屏功能模块
  components/ui/ # 设计系统原子组件
  hooks/        # 通用 React hooks
  services/     # API 客户端
  types/        # TypeScript 类型镜像
```

## 测试

### 后端
- 框架: pytest + pytest-asyncio
- 契约测试: `TestClient` 打真端点
- 隔离: `conftest.py` 通过 `IELTS_DB_PATH` 指向临时库
- 集成测试: 标记 `@pytest.mark.integration`，需 `RUN_INTEGRATION=1`

### 前端
- 框架: vitest + @testing-library/react + jsdom
- Mock: msw 拦截 API 请求
- 契约测试: 镜像后端响应形状

## 提交规范

```
<type>(<scope>): <subject>

type: feat / fix / docs / test / refactor / perf / chore
scope: speaking / listening / reading / writing / report / settings / shared / ci
subject: 一句话说清改了什么（中文）
```

示例：
```
feat(speaking): 新增 1 对 1 陪练模式
fix(report): 修复分项 Band 磁贴数据源
test(api): 补充异步批改队列用例
```

## 常见任务

### 添加新端点
1. 在 `docs/specs/ielts/spec-contracts.md` 中定义契约
2. 在 `backend/app/api/<module>.py` 中实现路由
3. 在 `backend/tests/test_api_<module>.py` 中写测试
4. 在 `frontend/src/services/api.ts` 中添加客户端函数
5. 更新 `frontend/src/types/ielts.ts` 类型镜像

### 添加新题库
1. 在 `backend/app/data/ielts/<module>/` 创建 JSON
2. 运行 `python tools/validate_ielts_data.py` 校验
3. 运行 `python tools/rebuild_dictionary.py` 更新词典（如需）

### 修改设计 token
1. 编辑 `frontend/src/index.css` 中的 CSS 变量
2. 同步更新 `docs/specs/ielts/spec-contracts.md` §8
3. 确保浅色/深色两套主题都有定义
4. 组件内禁止使用字面色值（必须用 token）
