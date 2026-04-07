export class EmcomClient {
    server;
    identity;
    constructor(server, identity) {
        this.server = server;
        this.identity = identity;
    }
    async get(path) {
        const res = await fetch(`${this.server}${path}`, {
            headers: { "X-Emcom-Name": this.identity },
        });
        if (!res.ok)
            throw new Error(`emcom ${path}: ${res.status} ${res.statusText}`);
        return res.json();
    }
    async getUnread() {
        return this.get(`/email/tags/unread`);
    }
    async getInbox() {
        return this.get(`/email/inbox`);
    }
    async getAll() {
        return this.get(`/email/all`);
    }
    async getWho() {
        const res = await fetch(`${this.server}/who`);
        if (!res.ok)
            throw new Error(`emcom /who: ${res.status}`);
        return res.json();
    }
    async health() {
        try {
            const res = await fetch(`${this.server}/health`);
            return res.ok;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=client.js.map