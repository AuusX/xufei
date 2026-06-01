import { connect } from "cloudflare:sockets";
import { z } from "zod";
import { tr, type AppLocale } from "./http";
import type { ApiAppSettings } from "@renewlet/shared/schemas/settings";

const DEFAULT_EHLO_DOMAIN = "renewlet.local";
const SUPPORTED_AUTH_METHOD = "PLAIN";

const emailAddressSchema = z.email();

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  replyTo: string;
  authMethod: typeof SUPPORTED_AUTH_METHOD;
}

export interface SmtpEmail {
  to: string[];
  subject: string;
  text: string;
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

class SmtpProtocolError extends Error {
  constructor(
    readonly code: number,
    readonly lines: string[],
  ) {
    super(`SMTP ${code}: ${lines.join(" ")}`);
    this.name = "SmtpProtocolError";
  }
}

class SmtpConnection {
  private socket: Socket;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(socket: Socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    this.writer = socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
  }

  async command(command: string, expectedCodes: readonly number[]): Promise<SmtpResponse> {
    await this.writeRaw(`${command}\r\n`);
    return await this.readResponse(expectedCodes);
  }

  async readResponse(expectedCodes: readonly number[]): Promise<SmtpResponse> {
    const lines: string[] = [];
    let code = 0;
    while (true) {
      const line = await this.readLine();
      const match = /^(\d{3})([- ])(.*)$/.exec(line);
      if (!match) throw new Error("Malformed SMTP response");
      code = Number.parseInt(match[1] ?? "0", 10);
      lines.push(match[3] ?? "");
      if (match[2] === " ") break;
    }
    if (!expectedCodes.includes(code)) throw new SmtpProtocolError(code, lines);
    return { code, lines };
  }

  async writeData(data: string): Promise<void> {
    await this.writeRaw(`${dotStuff(data)}\r\n.\r\n`);
  }

  upgradeTls(expectedServerHostname: string): SmtpConnection {
    this.reader.releaseLock();
    this.writer.releaseLock();
    return new SmtpConnection(this.socket.startTls({ expectedServerHostname }));
  }

  async close(): Promise<void> {
    await this.socket.close();
  }

  private async writeRaw(value: string): Promise<void> {
    await this.writer.write(this.encoder.encode(value));
  }

  private async readLine(): Promise<string> {
    while (!this.buffer.includes("\n")) {
      const result = await this.reader.read();
      if (result.done) throw new Error("SMTP connection closed");
      this.buffer += this.decoder.decode(result.value, { stream: true });
    }
    const index = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, index).replace(/\r$/, "");
    this.buffer = this.buffer.slice(index + 1);
    return line;
  }
}

export function notificationSmtpConfig(settings: ApiAppSettings, locale: AppLocale): SmtpConfig {
  // Cloudflare 部署面不再接受 SMTP secrets；邮件通知必须由当前账号在设置页显式配置。
  return buildSmtpConfig(
    settings.smtpHost,
    settings.smtpPort,
    settings.smtpSecure,
    settings.smtpUser,
    settings.smtpPassword,
    settings.smtpFrom,
    settings.smtpReplyTo,
    SUPPORTED_AUTH_METHOD,
    locale,
  );
}

export async function sendSmtpEmail(config: SmtpConfig, email: SmtpEmail, locale: AppLocale): Promise<void> {
  const to = email.to.map((item) => parseMailbox(item, locale));
  if (to.length === 0) throw new Error(tr(locale, "收件人邮箱为空", "Recipient email is empty"));
  const from = parseMailbox(config.from, locale);
  const replyTo = config.replyTo ? parseMailbox(config.replyTo, locale) : null;
  let connection = new SmtpConnection(connect(
    { hostname: config.host, port: config.port },
    {
      // Cloudflare 的 STARTTLS 必须在 socket 建立时声明；否则后续 startTls() 无法升级同一条连接。
      secureTransport: config.secure ? "on" : "starttls",
      allowHalfOpen: false,
    },
  ));

  try {
    await connection.readResponse([220]);
    const hello = await connection.command(`EHLO ${DEFAULT_EHLO_DOMAIN}`, [250]);
    if (!config.secure) {
      if (!supportsCapability(hello, "STARTTLS")) {
        throw new Error(tr(locale, "SMTP 服务器未声明 STARTTLS，Cloudflare 版不能明文发送邮件。", "SMTP server does not advertise STARTTLS; Cloudflare cannot send email in plaintext."));
      }
      await connection.command("STARTTLS", [220]);
      connection = connection.upgradeTls(config.host);
    }
    await deliverAfterTls(connection, config, email, from, to, replyTo);
  } catch (error) {
    throw new Error(publicSmtpError(error, locale));
  } finally {
    await connection.close().catch(() => undefined);
  }
}

export function publicSmtpError(error: unknown, locale: AppLocale): string {
  if (error instanceof SmtpProtocolError) return `SMTP ${error.code}: ${sanitizeProviderText(error.lines.join(" "))}`;
  const message = error instanceof Error ? error.message : String(error);
  return `${tr(locale, "SMTP 发送失败", "SMTP delivery failed")}: ${sanitizeProviderText(message)}`;
}

async function deliverAfterTls(
  connection: SmtpConnection,
  config: SmtpConfig,
  email: SmtpEmail,
  from: Mailbox,
  to: Mailbox[],
  replyTo: Mailbox | null,
): Promise<void> {
  const hello = await connection.command(`EHLO ${DEFAULT_EHLO_DOMAIN}`, [250]);
  if (config.username) {
    if (!supportsAuthPlain(hello)) throw new Error("SMTP server does not advertise AUTH PLAIN");
    await connection.command(`AUTH PLAIN ${base64Utf8(`\0${config.username}\0${config.password}`)}`, [235]);
  }
  await connection.command(`MAIL FROM:<${from.address}>`, [250]);
  for (const recipient of to) {
    await connection.command(`RCPT TO:<${recipient.address}>`, [250, 251]);
  }
  await connection.command("DATA", [354]);
  await connection.writeData(composeEmail(email, from, to, replyTo));
  await connection.readResponse([250]);
  await connection.command("QUIT", [221]).catch(() => undefined);
}

function buildSmtpConfig(
  hostRaw: string,
  portRaw: string,
  secure: boolean,
  usernameRaw: string,
  passwordRaw: string,
  fromRaw: string,
  replyToRaw: string,
  authMethodRaw: string,
  locale: AppLocale,
): SmtpConfig {
  const host = hostRaw.trim();
  const from = fromRaw.trim();
  const replyTo = replyToRaw.trim();
  if (!host || !portRaw.trim() || !from) {
    throw new Error(tr(locale, "SMTP 邮件通知未配置完整", "SMTP email notification is incomplete"));
  }
  const port = Number.parseInt(portRaw.trim(), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535 || String(port) !== portRaw.trim()) {
    throw new Error(tr(locale, "SMTP 端口无效", "Invalid SMTP port"));
  }
  if (port === 25) {
    // 这是 Cloudflare 平台限制，不写进 shared schema，避免误伤 Docker/VPS 上可自行放行的部署。
    throw new Error(tr(locale, "Cloudflare Workers 不支持 SMTP 25 端口，请改用 465、587、2525 或服务商支持的 submission 端口。", "Cloudflare Workers does not support SMTP port 25. Use 465, 587, 2525, or another provider-supported submission port."));
  }
  const username = usernameRaw.trim();
  const password = passwordRaw.trim();
  if (Boolean(username) !== Boolean(password)) {
    throw new Error(tr(locale, "SMTP 用户名和密码必须同时填写", "SMTP username and password must be filled together"));
  }
  const authMethod = authMethodRaw.trim().toUpperCase() || SUPPORTED_AUTH_METHOD;
  if (authMethod !== SUPPORTED_AUTH_METHOD) {
    throw new Error(tr(locale, "Cloudflare 版 SMTP 目前仅支持 AUTH PLAIN。", "Cloudflare SMTP currently supports AUTH PLAIN only."));
  }
  return { host, port, secure, username, password, from, replyTo, authMethod: SUPPORTED_AUTH_METHOD };
}

interface Mailbox {
  raw: string;
  address: string;
}

function parseMailbox(raw: string, locale: AppLocale): Mailbox {
  const trimmed = raw.trim();
  const match = /<([^<>]+)>$/.exec(trimmed);
  const address = (match?.[1] ?? trimmed).trim();
  if (!emailAddressSchema.safeParse(address).success) {
    throw new Error(tr(locale, `邮箱地址无效：${raw}`, `Invalid email address: ${raw}`));
  }
  return { raw: trimmed, address };
}

function composeEmail(email: SmtpEmail, from: Mailbox, to: Mailbox[], replyTo: Mailbox | null): string {
  const headers = [
    `From: ${formatMailboxHeader(from)}`,
    `To: ${to.map(formatMailboxHeader).join(", ")}`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  if (replyTo) headers.splice(2, 0, `Reply-To: ${formatMailboxHeader(replyTo)}`);
  return `${headers.join("\r\n")}\r\n\r\n${normalizeCrlf(email.text)}`;
}

function formatMailboxHeader(mailbox: Mailbox): string {
  const display = mailbox.raw.endsWith(">") ? mailbox.raw.slice(0, mailbox.raw.lastIndexOf("<")).trim().replace(/^"|"$/g, "") : "";
  if (!display) return mailbox.address;
  return `${encodeHeader(display)} <${mailbox.address}>`;
}

function supportsCapability(response: SmtpResponse, capability: string): boolean {
  return response.lines.some((line) => line.toUpperCase().startsWith(capability));
}

function supportsAuthPlain(response: SmtpResponse): boolean {
  return response.lines.some((line) => /^AUTH\b/i.test(line) && /\bPLAIN\b/i.test(line));
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeCrlf(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

function dotStuff(value: string): string {
  return normalizeCrlf(value)
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function encodeHeader(value: string): string {
  const safe = sanitizeHeader(value);
  return /^[\x20-\x7E]*$/.test(safe) ? safe : `=?UTF-8?B?${base64Utf8(safe)}?=`;
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function sanitizeProviderText(value: string): string {
  return value
    .replace(/AUTH\s+PLAIN\s+\S+/gi, "AUTH PLAIN [redacted]")
    .replace(/[A-Za-z0-9+/=]{32,}/g, "[redacted]")
    .slice(0, 500);
}
