/**
 * Tiling tree model — pure functions for binary tree workspace layouts.
 * Extracted from public/app.js for testability. app.js still has its own copies
 * (will be replaced with imports when we modularize the frontend).
 */
/** Build a balanced binary tree from a list of session names */
export function buildBalancedTree(sessions) {
    if (sessions.length === 0)
        return null;
    if (sessions.length === 1)
        return { type: "leaf", session: sessions[0] };
    const mid = Math.ceil(sessions.length / 2);
    const left = sessions.slice(0, mid);
    const right = sessions.slice(mid);
    const direction = sessions.length <= 2 ? "h" : "v";
    return {
        type: "split",
        direction,
        ratio: mid / sessions.length,
        children: [buildBalancedTree(left), buildBalancedTree(right)],
    };
}
/** Remove a session from the layout tree, collapsing empty splits */
export function removeSessionFromLayout(node, sessionName) {
    if (!node)
        return null;
    if (node.type === "leaf")
        return node.session === sessionName ? null : node;
    const left = removeSessionFromLayout(node.children[0], sessionName);
    const right = removeSessionFromLayout(node.children[1], sessionName);
    if (!left && !right)
        return null;
    if (!left)
        return right;
    if (!right)
        return left;
    return { ...node, children: [left, right] };
}
/** Append a leaf to the trailing (rightmost/bottommost) edge of the tree */
export function appendLeafToTree(node, newLeaf) {
    if (node.type === "leaf") {
        return { type: "split", direction: "h", ratio: 0.5, children: [node, newLeaf] };
    }
    return { ...node, children: [node.children[0], appendLeafToTree(node.children[1], newLeaf)] };
}
/** Get a flat list of all session names in the tree */
export function getLeafList(node, list = []) {
    if (!node)
        return list;
    if (node.type === "leaf") {
        list.push(node.session);
        return list;
    }
    getLeafList(node.children[0], list);
    getLeafList(node.children[1], list);
    return list;
}
/** Check if the tree contains a session by name */
export function treeContains(node, sessionName) {
    if (node.type === "leaf")
        return node.session === sessionName;
    return treeContains(node.children[0], sessionName) || treeContains(node.children[1], sessionName);
}
/** Count the number of leaves in the tree */
export function countLeaves(node) {
    if (node.type === "leaf")
        return 1;
    return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}
/** Insert a session adjacent to a target pane (for drag-drop) */
export function insertAdjacentToPane(node, targetSession, insertSession, side) {
    if (!node)
        return null;
    if (node.type === "leaf") {
        if (node.session !== targetSession)
            return node;
        const insertLeaf = { type: "leaf", session: insertSession };
        const direction = (side === "left" || side === "right") ? "h" : "v";
        const first = (side === "left" || side === "top") ? insertLeaf : node;
        const second = (side === "right" || side === "bottom") ? insertLeaf : node;
        return { type: "split", direction, ratio: 0.5, children: [first, second] };
    }
    return {
        ...node,
        children: [
            insertAdjacentToPane(node.children[0], targetSession, insertSession, side),
            insertAdjacentToPane(node.children[1], targetSession, insertSession, side),
        ],
    };
}
//# sourceMappingURL=tiling.js.map