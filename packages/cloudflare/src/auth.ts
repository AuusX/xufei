import { changePasswordBodySchema } from "@renewlet/shared/schemas/account";
import { loginBodySchema, setupCreateBodySchema, type SessionResponse } from "@renewlet/shared/schemas/auth";
import { adminCreateUserBodySchema, adminPatchUserBodySchema } from "@renewlet/shared/schemas/admin";
import { bearerToken, HttpError, json, ok, readJson, requestLocale, tr, type AppLocale } from "./http";
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

export async function setupStatus(request: Request, env: Env): Promise<Response> {
  return json({
    setupRequired: !(await hasEnabledAdmin(env)),
    setupEnabled: setupEnabled(env),
  });
}

export async function createInitialAdmin(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  // 初始化只允许“还没有启用管理员”这一瞬间进入；Cloudflare 版没有 PocketBase installer 可兜底。
  if (!setupEnabled(env)) throw new HttpError(403, tr(locale, "初始化已关闭", "Setup is disabled"));
  if (await hasEnabledAdmin(env)) throw new HttpError(403, tr(locale, "系统已初始化", "System has already been initialized"));
  const body = await readJson(request, setupCreateBodySchema, locale);
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, role, banned, ban_reason, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 0, '', ?, ?, ?)
  `).bind(newId("usr"), body.email.trim(), body.name.trim(), await hashPassword(body.password), timestamp, timestamp).run();
  return ok(201);
}

export async function login(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const body = await readJson(request, loginBodySchema, locale);
  const user = await findUserByEmail(env, body.email.trim());
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    throw new HttpError(400, tr(locale, "邮箱或密码不正确", "Invalid email or password"));
  }
  if (user.banned === 1) {
    throw new HttpError(403, tr(locale, "账号已被禁用", "Account is disabled"));
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

export async function session(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  return json(toSessionResponse(auth.token, auth.user));
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = bearerToken(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  return ok();
}

export async function changePassword(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJson(request, changePasswordBodySchema, locale);
  if (!(await verifyPassword(body.currentPassword, auth.user.password_hash))) {
    throw new HttpError(400, tr(locale, "当前密码不正确", "Current password is incorrect"));
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

export async function passwordResetStatus(): Promise<Response> {
  // Cloudflare 版不接收部署级 SMTP secrets；账号恢复走管理员用户管理里的重置密码。
  return json({ enabled: false });
}

export async function adminListUsers(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const users = await listUsers(env);
  return json({ users: users.map(toAdminUser) });
}

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

export async function adminPatchUser(request: Request, env: Env, userId: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAdmin(request, env);
  const user = await findUserById(env, userId);
  if (!user) throw new HttpError(404, tr(locale, "用户不存在", "User not found"));
  const body = await readJson(request, adminPatchUserBodySchema, locale);
  const nextRole = body.role ?? user.role;
  const nextBanned = typeof body.banned === "boolean" ? body.banned : user.banned === 1;
  await assertNotLastAdminMutation(env, locale, auth.user.id, user, nextRole, nextBanned);
  const timestamp = nowIso();
  const passwordHash = body.newPassword ? await hashPassword(body.newPassword) : null;
  const updateUser = env.DB.prepare(`
    UPDATE users SET role = ?, banned = ?, ban_reason = ?, password_hash = COALESCE(?, password_hash), updated_at = ? WHERE id = ?
  `).bind(
    nextRole,
    nextBanned ? 1 : 0,
    nextBanned ? tr(locale, "管理员禁用", "Disabled by administrator") : "",
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

export async function adminDeleteUser(request: Request, env: Env, userId: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAdmin(request, env);
  const user = await findUserById(env, userId);
  if (!user) throw new HttpError(404, tr(locale, "用户不存在", "User not found"));
  if (user.id === auth.user.id) throw new HttpError(400, tr(locale, "不能删除当前登录的管理员", "You cannot delete the current administrator"));
  await assertNotLastAdminMutation(env, locale, auth.user.id, user, "user", true);
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  return ok();
}

export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const locale = requestLocale(request);
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, tr(locale, "请先登录", "Please sign in first"));
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
  if (!row || row.banned === 1) throw new HttpError(401, tr(locale, "登录已失效", "Session has expired"));
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

export async function requireAdmin(request: Request, env: Env): Promise<AuthContext> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  if (auth.user.role !== "admin") throw new HttpError(403, tr(locale, "需要管理员权限", "Administrator permission required"));
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
    throw new HttpError(400, tr(locale, "不能禁用或降级当前登录的管理员", "You cannot disable or demote the current administrator"));
  }
  if (removesEnabledAdmin && await enabledAdminCount(env) <= 1) {
    throw new HttpError(400, tr(locale, "至少需要保留一个启用的管理员", "At least one enabled administrator is required"));
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
