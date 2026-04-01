import { log } from "../log.js";
export class EmcomPoller {
    client;
    intervalMs;
    sessionName;
    seenIds = new Set();
    timer = null;
    callback = null;
    unreadCallback = null;
    lastErrorCode = null;
    constructor(client, intervalMs, sessionName) {
        this.client = client;
        this.intervalMs = intervalMs;
        this.sessionName = sessionName;
    }
    onNewMessages(cb) {
        this.callback = cb;
    }
    onUnreadCount(cb) {
        this.unreadCallback = cb;
    }
    start() {
        if (this.timer)
            return;
        this.poll();
        this.timer = setInterval(() => this.poll(), this.intervalMs);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async poll() {
        try {
            const unread = await this.client.getUnread();
            if (this.lastErrorCode === "ECONNREFUSED") {
                log(`[${this.sessionName}] emcom reconnected`);
            }
            this.lastErrorCode = null;
            this.unreadCallback?.(unread.length);
            const newEmails = unread.filter((e) => !this.seenIds.has(e.id));
            if (newEmails.length > 0) {
                for (const e of newEmails)
                    this.seenIds.add(e.id);
                this.callback?.(newEmails);
            }
            const currentIds = new Set(unread.map((e) => e.id));
            for (const id of this.seenIds) {
                if (!currentIds.has(id))
                    this.seenIds.delete(id);
            }
        }
        catch (err) {
            const code = err.cause?.code ?? err.code ?? "UNKNOWN";
            if (code === "ECONNREFUSED") {
                if (this.lastErrorCode !== "ECONNREFUSED") {
                    log(`[${this.sessionName}] emcom unreachable (ECONNREFUSED)`);
                }
            }
            else {
                log(`[${this.sessionName}] poll error: ${code} — ${err}`);
            }
            this.lastErrorCode = code;
        }
    }
}
//# sourceMappingURL=poller.js.map