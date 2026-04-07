/**
 * Tiling tree model — pure functions for binary tree workspace layouts.
 * Extracted from public/app.js for testability. app.js still has its own copies
 * (will be replaced with imports when we modularize the frontend).
 */
export interface LeafNode {
    type: "leaf";
    session: string;
}
export interface SplitNode {
    type: "split";
    direction: "h" | "v";
    ratio: number;
    children: [TileNode, TileNode];
}
export type TileNode = LeafNode | SplitNode;
/** Build a balanced binary tree from a list of session names */
export declare function buildBalancedTree(sessions: string[]): TileNode | null;
/** Remove a session from the layout tree, collapsing empty splits */
export declare function removeSessionFromLayout(node: TileNode | null, sessionName: string): TileNode | null;
/** Append a leaf to the trailing (rightmost/bottommost) edge of the tree */
export declare function appendLeafToTree(node: TileNode, newLeaf: LeafNode): SplitNode;
/** Get a flat list of all session names in the tree */
export declare function getLeafList(node: TileNode | null, list?: string[]): string[];
/** Check if the tree contains a session by name */
export declare function treeContains(node: TileNode, sessionName: string): boolean;
/** Count the number of leaves in the tree */
export declare function countLeaves(node: TileNode): number;
/** Insert a session adjacent to a target pane (for drag-drop) */
export declare function insertAdjacentToPane(node: TileNode | null, targetSession: string, insertSession: string, side: "left" | "right" | "top" | "bottom"): TileNode | null;
