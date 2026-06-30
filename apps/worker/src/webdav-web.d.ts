// webdav/web 是 Worker/browser 运行入口，但包只给根入口发布类型；这里保持类型指向根入口，避免退回 Node-only runtime import。
declare module "webdav/web" {
  export * from "webdav";
}
