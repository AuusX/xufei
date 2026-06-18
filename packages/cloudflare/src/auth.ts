import { changePasswordBodySchema } from "@renewlet/shared/schemas/account";
import { loginBodySchema, setupCreateBodySchema, type SessionResponse } from "@renewlet/shared/schemas/auth";
import { appStatusResponseSchema } from "@renewlet/shared/schemas/app";
import { adminCreateUserBodySchema, adminPatchUserBodySchema } from "@renewlet/shared/schemas/admin";
import { bearerToken, HttpError, json, ok, readJson, requestLocale, type AppLocale } from "./http";
import { serverText } from "./server-i18n";
import {
  enabledAdminCount,
  findUserByEmail,
  findUserById,
  hasEnabledAdmin,
  listUsers,
  newId,
  nowIso,
  toAdminUser,
  USER_COLUMNS_FROM_USERS,
} from "./db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import type { AuthContext, Env, SessionAuthRow, UserRow } from "./types";

const DEFAULT_SESSION_TTL_DAYS = 30;

/**
 * appStatus 暴露认证前应用能力状态。
 *
 * Cloudflare v1 不支持 Docker Demo Mode，但仍必须返回同一契约，避免前端 capability 判断按运行面分叉。
 */
async function buildAppStatus(env: Env) {
  return appStatusResponseSchema.parse({
    setupRequired: !(await hasEnabledAdmin(env)),
    setupEnabled: setupEnabled(env),
    demoMode: false,
  });
}

export async function appStatus(_request: Request, env: Env): Promise<Response> {
  return json(await buildAppStatus(env));
}

/**
 * setupStatus 暴露旧首装入口状态。
 *
 * 新前端读取 appStatus；保留两字段响应，避免外部探针因 demoMode 额外字段解析失败。
 */
export async function setupStatus(_request: Request, env: Env): Promise<Response> {
  const status = await buildAppStatus(env);
  return json({
    setupRequired: status.setupRequired,
    setupEnabled: status.setupEnabled,
  });
}

/**
 * createInitialAdmin 完成 Cloudflare 运行面的唯一首次管理员创建。
 *
 * 这个端点承担安装向导的安全闸门：只有部署允许 setup 且 D1 中不存在启用管理员时才能写入。
 */
export async function createInitialAdmin(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  // 初始化只允许“还没有启用管理员”这一瞬间进入；Cloudflare 版没有 PocketBase installer 可兜底。
  if (!setupEnabled(env)) throw new HttpError(403, serverText(locale, "auth.setupDisabled"));
  if (await hasEnabledAdmin(env)) throw new HttpError(403, serverText(locale, "auth.setupAlreadyInitialized"));
  const body = await readJson(request, setupCreateBodySchema, locale);
  const timestamp = nowIso();
  // email 唯一索引是初始化竞态的最后闸门；并发首装失败必须暴露为创建失败，而不是补兼容重试。
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, role, banned, ban_reason, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 0, '', ?, ?, ?)
  `).bind(newId("usr"), body.email.trim(), body.name.trim(), await hashPassword(body.password), timestamp, timestamp).run();
  return ok(201);
}

/**
 * login 创建浏览器会话并返回一次性可见的 bearer token。
 *
 * D1 只保存 token hash，后续所有 Worker API 都通过 requireAuth 复核 session、用户状态和过期时间。
 */
export async function login(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const body = await readJson(request, loginBodySchema, locale);
  const user = await findUserByEmail(env, body.email.trim());
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    throw new HttpError(400, serverText(locale, "auth.invalidEmailOrPassword"));
  }
  if (user.banned === 1) {
    throw new HttpError(403, serverText(locale, "auth.accountDisabled"));
  }
  const token = randomToken();
  const timestamp = nowIso();
  const expires = new Date(Date.now() + sessionTtlDays(env) * 24 * 60 * 60 * 1000).toISOString();
  // 明文 token 只返回给浏览器；D1 只保存 hash，数据库泄漏时不能直接接管会话。
  await env.DB.prepare(`
    INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(newId("ses"), await sha256(token), user.id, expires, timestamp, timestamp).run();
  return json(toSessionResponse(token, user));
}

/**
 * session 复用 requireAuth 的完整认证检查恢复当前用户。
 *
 * 前端刷新时依赖该端点把本地 token 重新提升为可信用户状态，不能只读 localStorage 里的用户快照。
 */
export async function session(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  return json(toSessionResponse(auth.token, auth.user));
}

/**
 * logout 删除当前 bearer 对应的 D1 session。
 *
 * 登出保持幂等，便于前端在 token 已失效、跨标签清理或网络重试时统一走同一个清理路径。
 */
export async function logout(request: Request, env: Env): Promise<Response> {
  const token = bearerToken(request);
  if (token) {
    // 登出只按 hash 清当前 bearer；没有 token 也保持幂等，避免前端清缓存时被 401 卡住。
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  return ok();
}

/**
 * changePassword 更新当前用户密码并收敛会话。
 *
 * 改密后删除其它 session 是 Cloudflare 版的账号接管防线，避免旧设备继续持有密码变更前的 token。
 */
export async function changePassword(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJson(request, changePasswordBodySchema, locale);
  if (!(await verifyPassword(body.currentPassword, auth.user.password_hash))) {
    throw new HttpError(400, serverText(locale, "auth.currentPasswordIncorrect"));
  }
  const timestamp = nowIso();
  const passwordHash = await hashPassword(body.newPassword);
  // 改密后只保留当前 session，避免旧设备继续持有已知密码时代的 token。
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(passwordHash, timestamp, auth.user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").bind(auth.user.id, auth.session.id),
  ]);
  return ok();
}

/**
 * passwordResetStatus 固定声明 Cloudflare 运行面不支持邮件找回。
 *
 * Cloudflare 通知 SMTP 是账号级设置，不作为部署级认证恢复通道，避免未登录用户触发邮件发送面。
 */
export async function passwordResetStatus(): Promise<Response> {
  // Cloudflare 版不接收部署级 SMTP secrets；账号恢复走管理员用户管理里的重置密码。
  return json({ enabled: false });
}

/**
 * adminListUsers 返回管理员视图下的用户列表。
 *
 * 用户管理是跨账号数据面，必须始终先通过 requireAdmin，不能复用普通用户的 requireAuth。
 */
export async function adminListUsers(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const users = await listUsers(env);
  return json({ users: users.map(toAdminUser) });
}

/**
 * adminCreateUser 由管理员在 Cloudflare D1 中创建新账号。
 *
 * 这里不开放自助注册；账号生命周期全部挂在管理员边界下，和 Docker/PocketBase 管理语义保持一致。
 */
export async function adminCreateUser(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  await requireAdmin(request, env);
  const body = await readJson(request, adminCreateUserBodySchema, locale);
  const timestamp = nowIso();
  const user: UserRow = {
    id: newId("usr"),
    email: body.email.trim(),
    name: body.name.trim(),
    role: body.role,
    banned: 0,
    ban_reason: "",
    password_hash: await hashPassword(body.password),
    reset_token_hash: null,
    reset_token_expires_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, role, banned, ban_reason, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, '', ?, ?, ?)
  `).bind(user.id, user.email, user.name, user.role, user.password_hash, timestamp, timestamp).run();
  return json({ user: toAdminUser(user) }, { status: 201 });
}

/**
 * adminPatchUser 更新角色、禁用状态或重置密码。
 *
 * 角色/禁用变更会经过最后管理员保护；禁用账号时同步清 session，避免旧 bearer 在 TTL 内继续可用。
 */
export async function adminPatchUser(request: Request, env: Env, userId: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAdmin(request, env);
  const user = await findUserById(env, userId);
  if (!user) throw new HttpError(404, serverText(locale, "auth.userNotFound"));
  const body = await readJson(request, adminPatchUserBodySchema, locale);
  const nextRole = body.role ?? user.role;
  const nextBanned = typeof body.banned === "boolean" ? body.banned : user.banned === 1;
  await assertNotLastAdminMutation(env, locale, auth.user.id, user, nextRole, nextBanned);
  if (body.newPassword && user.id === auth.user.id) {
    // 自己改密码必须走 account/password 校验当前密码，不能让管理员 patch 成为弱认证入口。
    throw new HttpError(400, serverText(locale, "auth.selfPasswordResetForbidden"));
  }
  const timestamp = nowIso();
  const passwordHash = body.newPassword ? await hashPassword(body.newPassword) : null;
  const updateUser = env.DB.prepare(`
    UPDATE users SET role = ?, banned = ?, ban_reason = ?, password_hash = COALESCE(?, password_hash), updated_at = ? WHERE id = ?
  `).bind(
    nextRole,
    nextBanned ? 1 : 0,
    nextBanned ? serverText(locale, "auth.adminDisabledReason") : "",
    passwordHash,
    timestamp,
    user.id,
  );
  // 禁用账号立即踢下线；否则旧 token 会在 TTL 内继续通过 session 校验。
  if (nextBanned) {
    await env.DB.batch([
      updateUser,
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    ]);
  } else {
    await updateUser.run();
  }
  return ok();
}

/**
 * adminDeleteUser 删除指定账号及其 D1 关系数据。
 *
 * R2 对象不做同步删除；D1 metadata 级联失效后资产读取会先因 owner 查不到而返回 404。
 */
export async function adminDeleteUser(request: Request, env: Env, userId: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAdmin(request, env);
  const user = await findUserById(env, userId);
  if (!user) throw new HttpError(404, serverText(locale, "auth.userNotFound"));
  if (user.id === auth.user.id) throw new HttpError(400, serverText(locale, "auth.cannotDeleteCurrentAdmin"));
  await assertNotLastAdminMutation(env, locale, auth.user.id, user, "user", true);
  // D1 外键级联负责清 session/settings/subscriptions/assets metadata；R2 对象仍只能通过失效 metadata 变成不可读孤儿。
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  return ok();
}

/**
 * requireAuth 是 Cloudflare Worker API 的统一认证边界。
 *
 * 它把 bearer token、D1 session、用户启用状态和过期时间收敛在一次检查里，调用方不能自行拼接用户查询。
 */
export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const locale = requestLocale(request);
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, serverText(locale, "auth.loginRequired"));
  // session 与 user 联查是认证边界：过期、被禁用、用户被删都会在同一次检查里失效。
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT sessions.id AS session_id, sessions.token_hash AS session_token_hash, sessions.user_id AS session_user_id,
           sessions.expires_at AS session_expires_at, sessions.created_at AS session_created_at,
           sessions.last_seen_at AS session_last_seen_at, ${USER_COLUMNS_FROM_USERS}
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    LIMIT 1
  `).bind(tokenHash, nowIso()).first<SessionAuthRow>();
  if (!row || row.banned === 1) throw new HttpError(401, serverText(locale, "auth.sessionExpired"));
  const user = rowToUser(row);
  const session = {
    id: row.session_id,
    token_hash: row.session_token_hash,
    user_id: row.session_user_id,
    expires_at: row.session_expires_at,
    created_at: row.session_created_at,
    last_seen_at: row.session_last_seen_at,
  };
  await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(nowIso(), session.id).run();
  return { token, user, session };
}

/**
 * requireAdmin 在 requireAuth 之上收紧管理员操作边界。
 *
 * 所有跨用户数据、系统信息和账号生命周期操作都应走这里，避免普通登录态误触管理面。
 */
export async function requireAdmin(request: Request, env: Env): Promise<AuthContext> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  if (auth.user.role !== "admin") throw new HttpError(403, serverText(locale, "auth.adminRequired"));
  return auth;
}

function toSessionResponse(token: string, user: UserRow): SessionResponse {
  return {
    // 前端把 session.id 当 Bearer token 保存；不要替换成 D1 session row id。
    session: { id: token },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      banned: user.banned === 1,
    },
  };
}

function setupEnabled(env: Env): boolean {
  return env.SETUP_ENABLED !== "false";
}

function sessionTtlDays(env: Env): number {
  const value = Number.parseInt(env.SESSION_TTL_DAYS ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SESSION_TTL_DAYS;
}

async function assertNotLastAdminMutation(
  env: Env,
  locale: AppLocale,
  currentUserId: string,
  target: UserRow,
  nextRole: "user" | "admin",
  nextBanned: boolean,
): Promise<void> {
  const removesEnabledAdmin = target.role === "admin" && target.banned === 0 && (nextRole !== "admin" || nextBanned);
  // 防自锁分两层：当前管理员不能移除自己，最后一个启用管理员也不能被移除。
  if (target.id === currentUserId && removesEnabledAdmin) {
    throw new HttpError(400, serverText(locale, "auth.cannotDisableOrDemoteCurrentAdmin"));
  }
  if (removesEnabledAdmin && await enabledAdminCount(env) <= 1) {
    throw new HttpError(400, serverText(locale, "auth.atLeastOneEnabledAdmin"));
  }
}

function rowToUser(row: UserRow): UserRow {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    banned: row.banned,
    ban_reason: row.ban_reason,
    password_hash: row.password_hash,
    reset_token_hash: row.reset_token_hash,
    reset_token_expires_at: row.reset_token_expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
