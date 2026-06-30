(function () {
  try {
    // 首屏主题必须早于 React 启动落到 html；外部同源脚本满足生产 CSP 的 `script-src 'self'`。
    var mode = localStorage.getItem("renewlet_theme_mode") || "dark";
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var shouldDark = mode === "dark" || (mode === "system" && prefersDark);
    document.documentElement.classList.toggle("dark", shouldDark);

    var variant = localStorage.getItem("renewlet_theme_variant");
    if (!variant) return;
    if (["emerald", "ocean", "sunset", "lavender", "rose", "custom"].indexOf(variant) === -1) return;

    var root = document.documentElement;
    root.setAttribute("data-theme", variant);

    if (variant !== "custom") return;

    var raw = localStorage.getItem("renewlet_custom_theme_color");
    if (!raw) return;
    var color = JSON.parse(raw);
    if (!color || typeof color !== "object") return;

    var h = color.h, s = color.s, l = color.l;
    if (typeof h !== "number" || typeof s !== "number" || typeof l !== "number") return;
    if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) return;

    root.style.setProperty("--primary", h + " " + s + "% " + l + "%");
    root.style.setProperty("--primary-glow", h + " " + s + "% " + Math.min(l + 6, 100) + "%");
    root.style.setProperty("--ring", h + " " + s + "% " + l + "%");
    root.style.setProperty("--accent", h + " " + Math.max(s - 30, 20) + "% 20%");
    root.style.setProperty("--accent-foreground", h + " " + s + "% " + Math.min(l + 20, 100) + "%");
    root.style.setProperty("--success", h + " " + s + "% " + l + "%");
    root.style.setProperty("--sidebar-primary", h + " " + s + "% " + l + "%");
    root.style.setProperty("--sidebar-ring", h + " " + s + "% " + l + "%");
  } catch (_e) {
    // localStorage/CSSOM 异常不能阻断应用启动；React 后续同步会恢复可用主题状态。
  }
})();
