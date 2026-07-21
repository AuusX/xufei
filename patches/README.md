# patches/ — 集中管理的本地核心补丁

这里存放**不得不改上游核心文件**时的补丁（git diff 格式，`*.patch`）。

## 为什么需要它

二次开发的第一原则是**不改上游核心文件**，尽量用 `apps/worker/src/custom/`、`apps/web/src/custom/`
这类独立目录 + wrapper/adapter 接入（见 `docs/CUSTOMIZATION.md`）。

但有少数改动无法避免碰核心文件 —— 典型是**前端注册一个新栏目**：
React 路由表 `apps/web/src/App.tsx` 和导航栏 `apps/web/src/components/header.tsx` 必须知道新页面。
这类改动被做成**最小补丁**放在这里。

## 同步时如何工作

`Sync Renewlet Upstream` 在把仓库镜像成上游、还原 workflow、写回 Cloudflare 配置之后，会执行：

```bash
for patch_file in patches/*.patch; do
  git apply --3way "${patch_file}" || { echo "::error::补丁冲突"; exit 1; }
done
```

- 补丁**成功** → 你的核心改动被重新打上，功能照常。
- 补丁**冲突**（上游把被补丁的文件改动过大）→ workflow **报错中止，什么都不 push**，
  提示你人工处理。这满足“冲突不静默覆盖、优先保留自定义、需人工介入”的要求。

## 如何生成 / 更新补丁

在核心文件上做完最小改动后：

```bash
# 针对被改的核心文件生成补丁（示例：前端注册栏目）
git diff -- apps/web/src/App.tsx apps/web/src/components/header.tsx > patches/0001-register-carpool-nav.patch
```

> 注意：补丁只应包含**核心文件**的改动；自定义目录里的文件靠 `.upstream-sync-keep` 保留，不要进补丁。

## 排查补丁冲突

同步失败时，本地手动重放：

```bash
git fetch upstream main
git restore --source FETCH_HEAD --staged --worktree -- ':/' ':(exclude)apps/web/src/custom' # ……其余 exclude
git apply --3way patches/0001-register-carpool-nav.patch   # 看冲突在哪
# 手工改好核心文件后，重新生成补丁覆盖旧的：
git diff -- apps/web/src/App.tsx apps/web/src/components/header.tsx > patches/0001-register-carpool-nav.patch
```
