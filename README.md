# dsh-delete-conversation

## 这是什么 / 谁在用 / 怎么开始

给侧栏会话行的 `...` 菜单加一行「删除对话…」：确认后把会话目录挪进 `sessions.trash`，刷新侧栏那行就没了。
谁在用：本机 DSH 桌面版（Web 侧栏）的使用者。
怎么开始：装好插件 → 会话行 `...` → 删除对话… → 确认 → 刷新侧栏。

## 安装

```bat
dsh plugin --profile desktop add "<此插件目录绝对路径>"
```

装完自动进 profile bundles、HMR 生效；客户端那半边刷新页面或点 Unlag 生效。
不要再手工往 profile `cordis.patch.yml` 加 `insert` 行——手工行 + bundle 两层插同一个 id 会重复。

## 怎么用

1. 侧栏会话行 `...` 菜单点「删除对话…」。
2. 弹窗给出会话标题与丢失边界，确认。
3. Host 走 `POST /dsh-delete-conversation/delete`，把 `<session-root>/--<project>--/<id>/` 挪到 `<session-root>.trash/<stamp>-<id>/`（默认 `~/.dsh/sessions.trash/`）。
4. **删除后会话进 `sessions.trash`，可恢复**——把该目录挪回原项目目录即还原；**要刷新侧栏**（页面会自刷新，没刷到就手动刷新或点 Unlag）那行才消失。

## 配置

无配置项。边界写死在 Host 半边：只收 `POST`、要求 `x-dsh-delete-conversation: 1` 头 + loopback `Origin`；`?sessionId=<id>&dryRun=1` 只算路径不动文件。

## 已知限制 / 不在这里放什么

- 仍在本 Host 进程里 live 的会话拒绝删（`409 session-live`）：换会话或重启应用再删。
- 正在看的那个会话不能删（否则页面会刷进一个已不存在的会话）。
- 只挪会话目录（JSONL 日志）；内容寻址的附件 blob 与投影缓存记录留在原地，是无害孤儿、不会被列出。
- 界面里没有回收站浏览器，恢复靠手挪目录。
- 仓库不含任何密钥/账号数据。

## 版本与时间

v0.1.0 · 2026-11-01

---

## 原文档（保留）

Adds **删除对话… / Delete conversation…** to the Session row menu (the `...`
menu in the workspace sidebar) and deletes the stored session.

## What it does

- The menu row opens a confirmation dialog. The dialog explains the loss
  boundary and shows the conversation title.
- Confirming calls a Host-only route (`POST /dsh-delete-conversation/delete`).
  The Host moves the session directory out of the session root:
  `<session-root>/--<project>--/<id>/` → `<session-root>.trash/<stamp>-<id>/`
  (by default `~/.dsh/sessions.trash/...`), so the deletion is recoverable by
  hand.
- The session is removed from workspace accounting (archived set, pinned set,
  workspace membership) before the files move.
- The page reloads after a successful delete, so the row disappears.

## Safety

- **Live sessions are refused** (`409 session-live`). The persistence backend has
  no delete API and a live write handle could recreate a deleted log, so a
  session that is still live in this Host process cannot be deleted. Switch to
  another conversation or restart the app, then delete it.
- **The conversation you are viewing is refused** by the dialog: switch to
  another conversation first, otherwise the page would reload into a session
  that no longer exists.
- Existing sessions are never unlinked: they are moved into `sessions.trash`
  beside the session root, so a mistake can be undone by moving the directory
  back.
- The route accepts `POST` only, requires the `x-dsh-delete-conversation: 1`
  header and a loopback `Origin`, so other pages cannot trigger it.
- Deleting an archived/pinned conversation clears those flags first.

## Layout

| File | Purpose |
| --- | --- |
| `index.js` | Host half: route, guards, path encoding, trash move |
| `client.js` | Browser half (module-loader format): menu row + confirm dialog |
| `cordis.patch.yml` | Bundle patch that inserts the Host row |
| `scripts/test-host.mjs` | Plain-Node test of the Host logic against a temp root |
| `icon.svg` | Plugin artwork |

The path encoding is copied from `@deepseek-ai/dsh-session-persistence-jsonl`
(v0.2.1-rc.3) and is checked by the test against a real session root.

## Install

### Preferred: Creator mode

In a Creator-mode session, ask the agent to install this directory as a bundle:

```text
plugin_manager { action: install_bundle, target: "<absolute path to this directory>" }
```

`install_bundle` manages the profile's dependency, pnpm run and bundle list.

### Manual (this installation)

1. Link the package into the profile's `node_modules/@local`:

   ```text
   C:\Users\<you>\.dsh\profiles\desktop\node_modules\@local\dsh-delete-conversation
     → <this directory>
   ```

2. Add one insert row to `C:\Users\<you>\.dsh\profiles\desktop\cordis.patch.yml`:

   ```yaml
   - insert:
       - id: delete-conversation
         name: '@local/dsh-delete-conversation'
   ```

   Remove the block again to uninstall; the package directory itself can stay.

> Do not also install this directory as a bundle while the manual `insert` row
> exists: both layers would insert the same id.

The profile has HMR enabled (`hmr.root: []`), so the Host reloads profile
configuration on change. A page refresh (or the **Unlag** button) picks up the
client half if the running page does not receive the graph update.

## Verify

```text
# Host route mounted? (400/403 are expected without a session id/header)
curl -i -X POST "http://127.0.0.1:<port>/dsh-delete-conversation/delete"

# Resolve the target paths of a real session without deleting anything
curl -X POST "http://127.0.0.1:<port>/dsh-delete-conversation/delete?sessionId=<id>&dryRun=1" \
  -H "x-dsh-delete-conversation: 1"
# → 200 {"ok":true,"dryRun":true,"sessionDir":"…","trashDir":"…"}

# Host half mounted breadcrumb
type %TEMP%\dsh-delete-conversation.mounted.log
```

Logic test:

```text
node scripts/test-host.mjs
```

## Limitations

- A conversation that is still live in the Host cannot be deleted until the app
  is restarted or the session is released; this is deliberate.
- Only the session directory (its JSONL log) moves. Content-addressed attachment
  blobs and the projection-cache record are left behind; they are harmless
  orphans and never listed.
- There is no trash browser in the UI; recover by moving the directory from
  `sessions.trash` back under its project directory.
