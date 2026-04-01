import { EmcomClient, type EmcomEmail } from "./client.js";
export type NewMessagesCallback = (emails: EmcomEmail[]) => void;
export type UnreadCountCallback = (count: number) => void;
export declare class EmcomPoller {
    private client;
    private intervalMs;
    private sessionName;
    private seenIds;
    private timer;
    private callback;
    private unreadCallback;
    private lastErrorCode;
    constructor(client: EmcomClient, intervalMs: number, sessionName: string);
    onNewMessages(cb: NewMessagesCallback): void;
    onUnreadCount(cb: UnreadCountCallback): void;
    start(): void;
    stop(): void;
    private poll;
}
