export interface EmcomEmail {
    id: string;
    thread_id: string;
    sender: string;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    created_at: string;
    tags: string[];
}
export interface EmcomIdentity {
    name: string;
    description: string;
    location: string;
    last_seen: string;
    active: boolean;
}
export declare class EmcomClient {
    private server;
    private identity;
    constructor(server: string, identity: string);
    private get;
    getUnread(): Promise<EmcomEmail[]>;
    getInbox(): Promise<EmcomEmail[]>;
    getAll(): Promise<EmcomEmail[]>;
    getWho(): Promise<EmcomIdentity[]>;
    health(): Promise<boolean>;
}
