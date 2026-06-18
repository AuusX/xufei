import type { EmailTemplateData, EmailTemplateItem } from "./email-template";

/**
 * renderEmailTemplate 渲染通知邮件 HTML。
 *
 * 模板输出同时供 Cloudflare Worker 和 Go 邮件语义对齐；所有用户内容必须经过 escapeHtml/escapeAttr，
 * 因为邮件客户端会执行各自的 HTML/CSS 兼容规则，不能依赖浏览器 CSP。
 */
export function renderEmailTemplate(data: EmailTemplateData): string {
  const groupsOrContent = data.groups.length > 0 ? renderGroups(data) : renderContentPanel(data);
  const cta = data.cta ? renderCta(data) : "";
  return `<!doctype html>
<html lang="${escapeAttr(data.lang)}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(data.title)}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    @media screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-outer-pad { padding: 18px 10px !important; }
      .email-px { padding-left: 18px !important; padding-right: 18px !important; }
      .email-stack { display: block !important; width: 100% !important; text-align: left !important; }
      .email-stack-pad { padding-top: 8px !important; padding-right: 0 !important; }
      .email-amount { text-align: left !important; white-space: normal !important; }
      .email-brand-note { display: none !important; }
    }
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color: #0C0E12 !important; }
      .email-card { background-color: #13161B !important; border-color: #23272E !important; box-shadow: none !important; }
      .email-text { color: #F0F2F5 !important; }
      .email-muted { color: #9AA6B8 !important; }
      .email-panel { background-color: #1F2229 !important; border-color: #23272E !important; }
      .email-soft { background-color: #1F2229 !important; border-color: #23272E !important; }
      .email-rule { border-color: #23272E !important; }
    }
  </style>
</head>
<body class="email-bg" style="margin:0; padding:0; background-color:${data.theme.background}; color:${data.theme.text}; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${escapeHtml(data.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <center class="email-bg" style="width:100%; background-color:${data.theme.background};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; background-color:${data.theme.background};">
      <tr>
        <td align="center" class="email-outer-pad" style="padding:26px 12px;">
          <table role="presentation" class="email-container email-card email-ledger" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; border-collapse:separate; border-spacing:0; background-color:${data.theme.surface}; border:1px solid ${data.theme.border}; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(23,28,38,0.04);">
            <tr>
              <td class="email-px email-rule" style="padding:15px 24px; border-bottom:1px solid ${data.theme.border};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse;">
                  <tr>
                    <td align="left" valign="middle" class="email-text" style="vertical-align:middle; color:${data.theme.text}; font-size:14px; font-weight:700; line-height:20px;">Renewlet</td>
                    <td align="right" valign="middle" class="email-muted email-brand-note" style="vertical-align:middle; color:${data.theme.muted}; font-size:12px; font-weight:500; line-height:18px;">${escapeHtml(data.copy.brandTagline)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            ${renderSummaryRows(data)}
            ${groupsOrContent}
            ${cta}
            <tr>
              <td class="email-px" style="padding:17px 24px 20px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-rule" style="width:100%; border-collapse:collapse; border-top:1px solid ${data.theme.border};">
                  <tr>
                    <td class="email-muted" style="padding-top:12px; color:${data.theme.muted}; font-size:12px; line-height:19px;">
                      <p style="margin:0;"><strong class="email-text" style="color:${data.theme.text}; font-weight:600;">${escapeHtml(data.copy.generatedAt)}</strong> ${escapeHtml(data.timestamp)}</p>
                      <p style="margin:5px 0 0 0;">${escapeHtml(data.copy.footer)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`;
}

function renderSummaryRows(data: EmailTemplateData): string {
  if (data.summaryRows.length === 0) return "";
  const rows = data.summaryRows
    .map((row, index) => `${index === 0 ? "" : `<span style="color:${data.theme.border};"> / </span>`}${escapeHtml(row.label)} <strong class="email-text" style="color:${data.theme.text}; font-weight:700;">${escapeHtml(row.value)}</strong>`)
    .join("");
  return `<tr>
              <td class="email-px" style="padding:11px 24px 0 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-ledger-summary email-rule" style="width:100%; border-collapse:collapse; border-bottom:1px solid ${data.theme.border};">
                  <tr>
                    <td class="email-muted" style="padding:0 0 11px 0; color:${data.theme.muted}; font-size:12px; line-height:18px;">
                      ${rows}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function renderGroups(data: EmailTemplateData): string {
  const rows = data.groups.map((group) => `
                  <tr>
                    <td colspan="2" align="left" class="email-soft email-rule email-text" style="padding:9px 12px; background-color:${data.theme.surfaceMuted}; border-bottom:1px solid ${data.theme.border}; color:${data.theme.text}; font-size:13px; font-weight:700; line-height:19px;">${escapeHtml(group.label)}</td>
                    <td align="right" class="email-soft email-rule email-muted" style="padding:9px 12px; background-color:${data.theme.surfaceMuted}; border-bottom:1px solid ${data.theme.border}; color:${data.theme.muted}; font-size:12px; font-weight:600; line-height:18px;">${group.count}</td>
                  </tr>
                  ${group.items.map((item) => renderGroupItem(data, item)).join("")}`).join("");
  return `
            <tr>
              <td class="email-px" style="padding:14px 24px 0 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-panel email-ledger-table" style="width:100%; border-collapse:separate; border-spacing:0; background-color:${data.theme.surface}; border:1px solid ${data.theme.border}; border-radius:10px; overflow:hidden;">
                  ${rows}
                </table>
              </td>
            </tr>`;
}

function renderGroupItem(data: EmailTemplateData, item: EmailTemplateItem): string {
  return `
                  <tr>
                    <td width="48%" valign="top" class="email-stack email-rule" style="width:48%; vertical-align:top; padding:12px 14px 12px 12px; border-bottom:1px solid ${data.theme.border};">
                      <p class="email-text" style="margin:0; color:${data.theme.text}; font-size:13px; font-weight:600; line-height:19px;">${escapeHtml(item.name)}</p>
                      <p class="email-muted" style="margin:3px 0 0 0; color:${data.theme.muted}; font-size:12px; line-height:18px;">${escapeHtml(item.dateLabel)} &middot; ${escapeHtml(item.targetDate)}</p>
                    </td>
                    <td width="31%" valign="top" class="email-stack email-stack-pad email-rule" style="width:31%; vertical-align:top; padding:12px 12px 12px 0; border-bottom:1px solid ${data.theme.border};">
                      <p class="email-text" style="margin:0; padding-left:9px; border-left:2px solid ${item.accentText}; color:${data.theme.text}; font-size:12px; font-weight:600; line-height:18px;">${escapeHtml(item.detail)}</p>
                    </td>
                    <td width="21%" align="right" valign="top" class="email-stack email-stack-pad email-amount email-rule" style="width:21%; vertical-align:top; padding:12px 12px 12px 0; border-bottom:1px solid ${data.theme.border}; text-align:right; white-space:nowrap;">
                      <p class="email-text" style="margin:0; color:${data.theme.text}; font-size:13px; font-weight:700; line-height:19px;">${escapeHtml(item.amount)} ${escapeHtml(item.currency)}</p>
                    </td>
                  </tr>`;
}

function renderContentPanel(data: EmailTemplateData): string {
  const content = data.contentLines.map(escapeHtml).join("<br>");
  return `
            <tr>
              <td class="email-px" style="padding:14px 24px 0 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-panel email-soft" style="width:100%; border-collapse:separate; border-spacing:0; background-color:${data.theme.surfaceMuted}; border:1px solid ${data.theme.border}; border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p class="email-muted" style="margin:0 0 6px 0; color:${data.theme.muted}; font-size:12px; font-weight:600; line-height:18px;">${escapeHtml(data.copy.message)}</p>
                      <p class="email-text" style="margin:0; color:${data.theme.text}; font-size:13px; line-height:21px;">${content}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function renderCta(data: EmailTemplateData): string {
  const cta = data.cta;
  if (!cta) return "";
  return `
            <tr>
              <td class="email-px" style="padding:16px 24px 0 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="border-collapse:separate; border-spacing:0;">
                  <tr>
                    <td align="center" valign="middle" bgcolor="${data.theme.primary}" style="background-color:${data.theme.primary}; border-radius:8px;">
                      <a href="${escapeAttr(cta.url)}" style="display:inline-block; padding:0 15px; color:${data.theme.primaryText}; font-size:13px; font-weight:700; line-height:38px; text-decoration:none;">${escapeHtml(cta.label)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
