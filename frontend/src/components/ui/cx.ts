/** 类名拼接（无依赖，仅过滤 falsy） */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
