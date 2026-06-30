import type { MfaTotpSetupResponse } from "@/lib/api/schemas/auth";

// 账号安全区只有一个 overlay 状态机；密码管理器浮层可能把确认事件还给页面，不能让背景 MFA 操作与通行密钥管理并行打开。
export type MfaPasswordAction = "regenerate" | "disable";

export type AccountSecurityDialogState =
  | { type: "none" }
  | { type: "mfa_setup"; setup: MfaTotpSetupResponse }
  | { type: "mfa_password"; action: MfaPasswordAction }
  | { type: "recovery_codes"; codes: string[] }
  | { type: "passkeys_manager" };
