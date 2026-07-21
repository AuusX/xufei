# 二次开发指南（Renewlet fork · 拼车）

本仓库基于上游 [zhiyingzzhou/renewlet](https://github.com/zhiyingzzhou/renewlet)，通过 **Cloudflare Builds** 连接
GitHub 自动部署。本文档说明**如何在跟随上游更新的同时，安全地开发自己的功能而不被同步覆盖**。

> TL;DR：自己的代码放进 `apps/worker/src/custom/`、`apps/web/src/custom/`；把这些目录写进
> `.upstream-sync-keep`；不得已要改上游核心文件时，改动做成 `patches/*.patch`。之后照常跑
> `Sync Renewlet Upstream` 即可。

---

## 1. 仓库形态

pnpm monorepo：

| 目录 | 作用 | 你会不会碰 |
|---|---|---|
| `apps/worker/` | Cloudflare Worker（Hono，入口见 `wrangler.jsonc` 的 `main`） | 只加 `custom/`，不改上游 `.ts` |
| `apps/web/` | React 前端（构建到 `apps/web/dist`，由 Worker 的 `ASSETS` 托管） | 只加 `custom/` + 极小注册补丁 |
| `apps/website/` `apps/docker-server/` | 官网 / Docker 部署线 | 一般不碰 |
| `packages/shared/` | 前后端共享库 | 只读引用 |

部署事实源是仓库根的 **`wrangler.jsonc`**（Cloudflare Builds 直接读它）。

---

## 2. 上游同步为什么会“吃掉”你的改动

`Sync Renewlet Upstream`（`.github/workflows/sync-renewlet-upstream.yml`）不是 `git merge`
（本仓库与上游**没有共同历史**，是 Deploy Button 快照，无法正常 merge），而是**整树镜像**：

```
git restore --source upstream/main --staged --worktree :/
```

它把工作树**整体还原成上游**：上游没有的文件被**删除**，你改过的上游文件被**还原**。
所以任何“散落在上游目录里”的自定义改动，下次同步都会消失。

---

## 3. 三层保护（本仓库已改造）

### Layer 1 — 排除层：`.upstream-sync-keep`
清单里的路径（含整棵子目录）在镜像时用 `git pathspec :(exclude)` 跳过，**永不被上游覆盖/删除**。
新增自定义目录时，务必同步登记到这个文件。

### Layer 2 — Cloudflare 配置字段级保留
`wrangler.jsonc` **不**放进排除清单（否则收不到上游对兼容日期 / assets 的改进），
而是由 workflow 在镜像后**把你的这些字段写回**：

- `name`（Worker 名）
- `main`（Worker 入口；默认即上游 `index.ts`，保留只为你日后想换自定义入口时不被覆盖）
- D1 `database_name` / `database_id`
- R2 `bucket_name`
- `vars`（你的值优先，上游新增的 var 会并入）

> 需要保留更多 wrangler 字段（如自定义 `routes`）时，改 workflow 里两处 node 块的 `preserved` 对象即可。

### Layer 3 — 补丁层：`patches/*.patch`
不得不改上游核心文件时（典型：前端注册新栏目），改动做成补丁放 `patches/`。
镜像后 workflow 用 `git apply --3way` 重新打上；**冲突则报错中止、不 push**，提示人工处理。
详见 `patches/README.md`。

---

## 4. 一次上游同步会发生什么（改造后）

1. 手动在 GitHub Actions 触发 `Sync Renewlet Upstream`。
2. 备份 `.github/workflows/`，抓取 `wrangler.jsonc` 的保留字段。
3. 镜像上游，但 `:(exclude)` 掉 `.upstream-sync-keep` 里的路径。
4. 还原 workflow 目录、写回 wrangler 保留字段。
5. 重新应用 `patches/*.patch`（失败即中止）。
6. commit 并 push 到触发分支（默认 `main`）→ Cloudflare Builds 部署。

### （可选）审核式同步
若想“上游更新先审核再上线”，不要在 `main` 上触发，而是：

```
# 一次性建分支
git switch -c upstream-sync && git push -u origin upstream-sync
```

之后在 Actions 里**选择 `upstream-sync` 分支**运行 `Sync Renewlet Upstream`，它会 push 到
`upstream-sync`；在 GitHub 开 `upstream-sync → main` 的 PR，diff 里只会出现**上游变更**
（你的自定义目录被排除，不参与 diff），看过无误再合并，Cloudflare 才部署生产。

---

## 5. 如何加一个后端功能

自定义逻辑放 `apps/worker/src/custom/`，导出一个 `registerXxxRoutes(app)`，再用一处**最小补丁**
让上游 `index.ts` 调用它（和前端注册栏目同一套 `patches/` 机制）：

- 在 `custom/<feature>/routes.ts` 导出 `registerXxxRoutes(app)`，用 `app.get/post/...` 把接口挂到上游
  传入的 Hono `app` 上；接口一律用 **`/api/custom/*`** 前缀（天然落在 wrangler 的
  `run_worker_first: /api/*`，无需改路由配置）。
- `index.ts` 里加两行（import + `registerXxxRoutes(app);`），做成 `patches/000X-*.patch`，同步后自动重打。
- 复用上游 `requireAuth(request, env)` 鉴权、`http.ts` 响应助手、全局 locale middleware 与 `onError`。
- 自定义数据表用运行时 `CREATE TABLE IF NOT EXISTS` **懒建**（见 `apps/worker/src/custom/carpool/store.ts`），
  不占用上游迁移编号、不依赖 `wrangler d1 migrations apply` 流水线。

> 除 `index.ts` 那处两行补丁外，只**引用（import）**上游函数、不修改上游文件。上游若改了被引用的签名，
> 或改动 `index.ts` 导致补丁冲突，`check:cloudflare` typecheck / 同步时的 `git apply` 会报错，不会静默出错。

## 6. 如何加一个前端栏目

- 页面与组件全部放 `apps/web/src/custom/<feature>/`（已被排除保护）。
- 只有**两处**核心注册需要动，且做成补丁：
  - `apps/web/src/App.tsx`：加一条 `<Route>`。
  - `apps/web/src/components/header.tsx`：加一个导航项。
- 生成补丁：`git diff -- apps/web/src/App.tsx apps/web/src/components/header.tsx > patches/0001-register-carpool-nav.patch`

---

## 7. 本仓库的自定义功能：拼车

拼车 = 系统自带**家庭共享（cost-sharing）**的增强视图。二者**共用同一份数据**
（订阅上的 `cost_sharing_json`：成员 + 付款金额），因此天然双向同步；拼车独有的
**上车时间 / 按成员到期时间**存在自定义 overlay 表 `carpool_member_meta`。

| 部件 | 位置 |
|---|---|
| 拼车 API（`/api/custom/carpool/*`） | `apps/worker/src/custom/carpool/routes.ts` |
| Worker 路由挂载补丁 | `patches/0002-mount-carpool-routes.patch`（index.ts 两行） |
| overlay 表（懒建） | `apps/worker/src/custom/carpool/store.ts` |
| 前端栏目 | `apps/web/src/custom/carpool/` |
| 路由/导航注册补丁 | `patches/0001-register-carpool-nav.patch` |

数据流：

```
家庭共享 UI ─┐                                   ┌─ 拼车 UI
            ├─►  subscriptions.cost_sharing_json ◄┤   （写这里 = 两边同步）
成员/金额 ───┘                                   └─ 上车/到期时间 ─► carpool_member_meta（自定义表）
```

---

## 8. 约定与坑

- **不要**把密钥写进 `wrangler.jsonc` 的 `vars`（`check:deploy` 守卫会拦）；密钥用 Cloudflare Secrets。
- **不要**改上游的 i18n `.po` 目录（有 `i18n:check` 守卫）；自定义栏目的文案先用内置字符串。
- 自定义接口务必按 `user_id` 隔离数据（复用 `requireAuth` 拿到的 `auth.user.id`）。
- 新增自定义目录 → 记得加进 `.upstream-sync-keep`。
- 改了上游核心文件 → 记得更新对应 `patches/*.patch`。
