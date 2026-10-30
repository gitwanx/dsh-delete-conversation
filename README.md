# dsh-delete-conversation（DSH 删除对话插件）

在 DSH 工作区侧边栏的会话 `...` 菜单里增加「删除对话…」，把会话目录移动到可恢复的 `sessions.trash`，而不是直接物理删除。

## 安装

```powershell
dsh plugin --profile desktop add "<本仓库目录的绝对路径>"
```

安装后 DSH 会热加载。这个插件是 DSH bundle，`cordis.patch.yml` 会插入 Host 行。

## 使用

1. 打开工作区侧边栏。
2. 在会话行点 `...`。
3. 选择「删除对话…」。
4. 确认后页面刷新，会话从列表消失。
5. 文件实际移动到 `~/.dsh/sessions.trash/<时间戳>-<会话ID>/`，需要时可手动移回。

## 安全边界

- **正在运行的会话拒绝删除**（`409 session-live`）。
- **当前正在查看的会话拒绝删除**，先切换到别的会话。
- 只接受 Host-only 路由，要求 `x-dsh-delete-conversation: 1` 请求头和 loopback Origin。
- 已归档/置顶会话会先清除标记，再移动目录。
- 不是物理 `unlink`，误删可从 `sessions.trash` 恢复。

## 配置

不需要配置文件；插件通过 DSH profile 加载。卸载时移除 profile 中的 bundle/insert 行即可，`sessions.trash` 不会自动删除。

## 文件

- `index.js`：Host 路由、守卫、路径编码、移动到 trash
- `client.js`：浏览器侧菜单和确认弹窗
- `cordis.patch.yml`：DSH bundle 插入声明
- `scripts/test-host.mjs`：Host 逻辑测试
- `icon.svg`：图标

## 许可

MIT。版本：v0.1.0 · 2026-10-30。