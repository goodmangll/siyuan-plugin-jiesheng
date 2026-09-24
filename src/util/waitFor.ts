/**
 * 有界轮询：**等到某个写入真的可见**再往下走。
 *
 * 为什么需要它：思源的 `setBlockAttrs` 返回 code=0 之后，
 * 用 SQL 去查**还读不到新值** —— 真机实测 0 秒时读到 None、1 秒后才读到。
 * 视图那边"写完立刻重载"就会读到旧值，看起来像没生效。
 *
 * 所以写入之后要等一等。等到或者超时都返回，**不抛异常** ——
 * 写入本身已经成功了，调用方不该因为"我没等到"而失败。
 */

export interface WaitOptions {
    timeoutMs?: number;
    intervalMs?: number;
}

export async function waitFor<T>(
    fn: () => Promise<T>,
    ok: (value: T) => boolean,
    opts: WaitOptions = {},
): Promise<T | null> {
    const timeoutMs = opts.timeoutMs ?? 3000;
    const intervalMs = opts.intervalMs ?? 120;
    const deadline = Date.now() + timeoutMs;
    let last: T | null = null;

    for (;;) {
        try {
            const v = await fn();
            last = v;
            if (ok(v)) {
                return v;
            }
        } catch {
            // 查询可能一时失败，继续重试
        }
        if (Date.now() >= deadline) {
            return last;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
}
