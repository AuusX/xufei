/**
 * 上游 cost_sharing_json 契约守卫。
 *
 * `cost_sharing_json` 是与上游「家庭共享」共用的字段，上游每次出站都会用 `costSharingSchema` 重新
 * 校验（`db.ts` 的 `toApiSubscription`）。拼车这边的入参校验比上游宽（成员上限、姓名长度、custom
 * 模式下金额必填等），一旦写进上游不认的形状，**所有**读订阅的接口都会 500——而拼车页自己用的是
 * 宽松的 `parseCostSharing`，照样正常显示，故障看起来跟拼车毫无关系。
 *
 * 所以写库前先在这里过一遍上游同一个 schema，把问题变成一个能看懂的 400。
 */
import type { CostSharing } from "@renewlet/shared/cost-sharing";
import { costSharingSchema } from "@renewlet/shared/schemas/subscriptions";

/** 上游校验里出现的问题翻译成给用户看的中文提示。 */
const MESSAGES: Array<[test: RegExp, message: string]> = [
  [/custom cost sharing amounts/i, "自定义金额模式下，每位车友都必须填写付款金额"],
  [/cost sharing members/i, "车友 ID 重复，请重新保存"],
];

/**
 * 返回 null 表示可以安全写入；否则返回中文原因。
 *
 * 只在成员数组非空时调用——成员为空时写的是上游约定的空对象 `{}`，不走 schema。
 */
export function costSharingContractError(costSharing: CostSharing): string | null {
  const result = costSharingSchema.safeParse(costSharing);
  if (result.success) return null;

  const issue = result.error.issues[0];
  const raw = issue?.message ?? "数据不符合要求";
  for (const [test, message] of MESSAGES) {
    if (test.test(raw)) return message;
  }
  // 长度/数量类的 zod 原文对用户没意义，按字段给出人话。
  const path = issue?.path.join(".") ?? "";
  if (path.startsWith("members")) {
    if (costSharing.members.length > 20) return "一辆车最多 20 位车友";
    if (costSharing.members.some((member) => member.name.length > 80)) return "车友姓名最长 80 个字";
    if (costSharing.members.some((member) => (member.customAmount ?? 0) > 1_000_000_000)) return "付款金额过大";
  }
  return `拼车数据不符合订阅端要求（${raw}）`;
}
