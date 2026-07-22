/**
 * 拼车自定义表的运行时建表 / 补列（懒执行）。
 *
 * 所有自定义表都用 `CREATE TABLE IF NOT EXISTS` 懒建；旧版 `carpool_member_meta` 缺列时用
 * PRAGMA + ALTER 幂等补列，不占用上游 D1 迁移编号。从 store.ts 拆出以控制单文件长度。
 */
import type { Env } from "../../types";

const CREATE_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS carpool_member_meta (
    user_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    join_date TEXT,
    expiry_date TEXT,
    status TEXT,
    billing_cycle TEXT,
    custom_days INTEGER,
    auto_calc_expiry INTEGER,
    reminder_days INTEGER,
    wechat TEXT,
    email TEXT,
    amount_cny REAL,
    reminded_for TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, subscription_id, member_id)
  )`,
  `CREATE TABLE IF NOT EXISTS carpool_subscription_meta (
    user_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    account TEXT,
    card_last4 TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, subscription_id)
  )`,
  `CREATE TABLE IF NOT EXISTS carpool_plan (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS carpool_plan_subscription (
    user_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (plan_id, subscription_id)
  )`,
  `CREATE TABLE IF NOT EXISTS carpool_notification (
    user_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    webhook_url TEXT,
    webhook_method TEXT,
    webhook_headers TEXT,
    webhook_payload TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS carpool_notification_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    error TEXT,
    context TEXT
  )`,
];

// 旧版 carpool_member_meta 只有 join_date/expiry_date；这些列在已存在的表上用 ALTER 幂等补齐。
const MEMBER_META_ADDED_COLUMNS: Array<[name: string, def: string]> = [
  ["status", "TEXT"],
  ["billing_cycle", "TEXT"],
  ["custom_days", "INTEGER"],
  ["auto_calc_expiry", "INTEGER"],
  ["reminder_days", "INTEGER"],
  ["wechat", "TEXT"],
  ["email", "TEXT"],
  ["amount_cny", "REAL"],
  ["reminded_for", "TEXT"],
];

const SUBSCRIPTION_META_ADDED_COLUMNS: Array<[name: string, def: string]> = [["card_last4", "TEXT"]];

/** 幂等补列：只对表上缺失的列执行 ALTER ADD COLUMN。 */
async function migrateColumns(env: Env, table: string, columns: Array<[name: string, def: string]>): Promise<void> {
  const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const existing = new Set((info.results ?? []).map((row) => row.name));
  for (const [name, def] of columns) {
    if (!existing.has(name)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`).run();
  }
}

let schemaReady: Promise<void> | null = null;

/** 懒建自定义表并补齐旧表缺列；失败时清空缓存以便下次请求重试。 */
export function ensureCarpoolSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(CREATE_TABLE_STATEMENTS.map((sql) => env.DB.prepare(sql)));
      await migrateColumns(env, "carpool_member_meta", MEMBER_META_ADDED_COLUMNS);
      await migrateColumns(env, "carpool_subscription_meta", SUBSCRIPTION_META_ADDED_COLUMNS);
    })()
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}
