# 麦克风权限在 Windows / WebView2 下的真实机制（T6 交付）

> 结论先行：**Tauri 2 没有任何“麦克风 / media / getUserMedia” capability**。麦克风权限不由
> `capabilities/main.json` 控制，而由 **WebView2（Chromium）的媒体捕获权限**控制。任何试图往
> `permissions[]` 里加 `microphone`、`media`、`core:media:*` 之类名字的做法都会 **ACL 校验失败**
> （这些 permission 根本不存在）。本文记录我在本机核实过的证据与最终采用的方案。

## 1. 我核实了什么

- 已安装的 Tauri 依赖（`frontend/src-tauri/Cargo.lock`）：`tauri = 2.11.5`，运行层为
  `tauri-runtime-wry = 2.11.4` + `wry = 0.55.1`。
- `frontend/src-tauri/gen/schemas/desktop-schema.json`（Tauri 自动生成的 ACL 白名单）里，可用的
  permission 前缀只有：`core:app / core:event / core:image / core:menu / core:path / core:resources /
  core:tray / core:webview / core:window` 以及 `shell:*`。**没有 `opener`、没有 `fs`、没有任何
  `mic/media/getUserMedia` 相关条目。** → 麦克风不可能通过 capability 授权。
- 直接读 `wry-0.55.1/src/webview2/mod.rs`：
  - 第 500–509 行：wry 注册了 WebView2 的 `PermissionRequested` 事件处理器，但**只对
    `COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ` 调 `SetState(ALLOW)`**；其它 kind（含
    `..._MICROPHONE`）不处理，停留在默认状态。
  - WebView2 是无浏览器 UI 的控件：**没有弹出“允许使用麦克风？”的原生对话框**；未被 `SetState` 放行的
    请求会被**静默拒绝** → 前端 `getUserMedia({audio:true})` 抛 `NotAllowedError`。
  - 第 294–320 行：wry 通过 `CoreWebView2EnvironmentOptions` 设置 `AdditionalBrowserArguments`，默认串是
    `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`，**不含任何放行麦克风的开关**。

> 也就是说：麦克风能不能用，取决于 (a) WebView2 的媒体捕获权限是否被放行，(b) Windows 系统级“麦克风隐私”
> 是否允许桌面应用访问，(c) 页面是否为安全上下文。三者缺一，录音就失败。

## 2. 本应用采用的方案（已写入 `main.rs`）

在 `main()` 最开头、任何窗口/WebView2 环境创建之前设置环境变量：

```rust
std::env::set_var(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--use-fake-ui-for-media-stream",
);
```

- `--use-fake-ui-for-media-stream` 让 Chromium **自动批准**媒体捕获权限请求（等价于替用户点了“允许”），
  但仍然采集**真实麦克风**设备（注意：它不是 `--use-fake-device-for-media-stream`，后者会灌入合成的假音频，
  我们**不要**那个）。
- 按 WebView2 文档，`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量与程序内 `AdditionalBrowserArguments`
  是**叠加合并**的，所以该开关会附加在 wry 的默认串之后，不会覆盖它。
- 该开关对**整个 WebView2 进程**生效，因此听力/口语录音、以及任何 `getUserMedia` 都会被放行。

### 为什么没用 `capabilities`
`capabilities/main.json` 保持“只含 schema 里真实存在的 permission”。`opener` / `fs` 插件在当前
`Cargo.toml` 里根本没作为依赖（只有 `tauri-plugin-shell`），给它们加 permission 会让 `tauri build` 的
ACL 校验报错。当前四科功能也不需要从 JS 侧读写文件系统或打开外部程序（导出 CSV/Anki 用 blob + `<a download>`
即可，落库/缓存全在后端进程里），故**有意省略** `opener`/`fs`。若 Wave 2/3 前端确实需要，正确做法是
**同时**加 Rust 插件依赖（`tauri-plugin-opener`/`tauri-plugin-fs`）+ `Cargo.toml` + `.plugin(...init())`
+ capability permission，三处一起改，缺一不可。

## 3. 其它可行方案（备选，本应用未采用）

1. **自定义 `PermissionRequested` 处理器（最精确）**：在 Rust 侧拿 `raw_window`，用 `webview2-com-sys`
   对 `ICoreWebView2PermissionRequestedEventHandler` 判断 `PermissionKind == MICROPHONE` 时
   `SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)`。缺点：要引入 `webview2-com` 依赖、写 COM unsafe 代码，
   且要绕过 wry 内置处理器；对单人本地应用性价比低。
2. **注册表/组策略（企业分发）**：用 `Microsoft Edge WebView2` 的
   `MediaPermissionSettings`/`AutoGenerateCertificateAndAllowAll` 类策略集中放行来源。适合公司批量部署，
   不适合个人。
3. **仅开发模式**：`npm run dev` 用系统浏览器（http://localhost:5173）时浏览器会正常弹权限框，本开关只影响
   打包后的 WebView2 窗口。

## 4. 前端必须配合的两件事（不是 pkg agent 的文件，但契约里要求）

- **安全上下文**：`getUserMedia` 只在 secure context 可用。Tauri 生产窗口 origin 为
  `http://tauri.localhost`——WebView2 把 `http://*.localhost` 视为可信/安全上下文，`isSecureContext` 为 true，
  所以 `navigator.mediaDevices` 可用；若前端改用别的 origin 需注意这点。
- **失败可见（CONSTITUTION §3）**：录音入口必须 `catch` `getUserMedia` 的异常并显示**可操作的中文文案**，
  同时保留「键盘输入文本」兜底（AC-S3b），保证麦克风不可用时口语练习不中断。

## 5. 用户可见错误文案（麦克风被拒绝时，供前端 `useRecorder` 使用）

| 场景 | 判定 | 文案 |
|---|---|---|
| 权限被拒 / 未放行 | `NotAllowedError` / `SecurityError` | 「麦克风权限被拒绝。请确认已授予本应用麦克风权限：Windows 设置 → 隐私和安全性 → 麦克风 → 打开『让桌面应用访问麦克风』，然后重启 IELTS Insight。」 |
| 设备不存在 | `NotFoundError` / `DevicesNotFoundError` | 「未检测到麦克风设备。请连接麦克风后重试，或改用下方『直接输入答案文本』继续练习。」 |
| 设备被占用 | `NotReadableError` / `TrackStartError` | 「麦克风正被其它程序占用。请关闭占用该设备的程序后重试，或改用文本输入继续练习。」 |
| 约束不匹配（指定 deviceId 失效） | `OverconstrainedError` | 「所选录音设备不可用。请在设置里重新选择输入设备，或改用文本输入继续练习。」 |
| 非安全上下文 | `navigator.mediaDevices` 为 undefined | 「当前环境不支持录音（非安全上下文）。请通过桌面应用窗口打开，或改用文本输入继续练习。」 |

## 6. ⚠️ 验证状态（诚实声明）

- 我**未在运行时实测**过打包后的 WebView2 窗口能否真的拿到麦克风流：本机是无 GUI 会话的命令行环境，
  无法启动图形窗口并点录音。上面第 1、2 节是基于**读源码得到的静态结论**（wry 只放行 clipboard、默认 browser
  args 不含麦克风开关），逻辑上成立，但：
  - `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 与 wry 程序内参数的“叠加而非替换”这一行为，
    需要在真实打包 exe 上验证（Wave 3 实跑：口语 Part 2 点录音 → 能采到声音并转写 = 通过）。
  - 若 Wave 3 实测发现仍 `NotAllowedError`，回退到第 3.1 节“自定义 PermissionRequested 处理器”方案，
    那是唯一 100% 受控的路径。
- **可能成为 launch blocker**：如果自动放行开关不生效，打包版录音会全线失败（开发版浏览器无此问题）。
  Wave 3 集成时这是**第一优先**要实测的点。

## 7. 相关文件

- 实现：`frontend/src-tauri/src/main.rs`（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 设置 + sidecar 守卫）。
- capability（有意不含 mic）：`frontend/src-tauri/capabilities/main.json`。
- 契约来源：`docs/specs/ielts/spec-contracts.md` §9；验收：`spec-product.md` AC-S3 / AC-S3b / AC-C4。
