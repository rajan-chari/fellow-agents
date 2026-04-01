// @ts-check
// pty-win — Folder-centric terminal multiplexer

// ===== State =====

/** @typedef {{ type: "leaf", session: string }} LeafNode */
/** @typedef {{ type: "split", direction: "h"|"v", ratio: number, children: [TileNode, TileNode] }} SplitNode */
/** @typedef {LeafNode | SplitNode} TileNode */
/** @typedef {{ id: string, name: string, layout: TileNode | null }} Workspace */

const state = {
  ws: null,
  sessions: new Map(),    // name -> SessionInfo
  workspaces: [],         // Workspace[]
  activeWorkspaceId: null,
  terminals: new Map(),   // sessionName -> { term, fitAddon, opened: boolean }
  focusedPane: null,
  isDashboard: true,
  isDiag: false,
  sidebarVisible: true,
  favorites: [],          // string[] — favorite root paths
  folderCache: new Map(), // path -> FolderEntry[]
  visitedFolders: [],     // {name, path, identityName?, isClaudeReady}[] for quick-open
  expandedPaths: new Set(),
  ctxTarget: null,        // path for context menu
  sessionMeta: new Map(), // name -> { workingDir, command } for recreating after restart
  paneGroups: new Map(),  // group -> { claude?: name, pwsh?: name, activeType: "claude"|"pwsh" }
  folderInfoCache: new Map(), // normPath(workingDir) -> { isClaudeReady, hasIdentity, identityName }
  pinnedFolders: [],          // string[] — paths pinned to Quick Access
  aiPresets: [
    { name: "Claude", command: "claude", icon: "\u25b6" },
    { name: "Agency CC", command: "agency cc", icon: "A" },
    { name: "Agency CP", command: "agency cp", icon: "CP" },
    { name: "Copilot", command: "copilot", icon: "GH" },
  ],
  aiDefaultIndex: parseInt(localStorage.getItem("pty-win-ai-default") || "0") || 0,
};

let nextWorkspaceId = 1;
let dragSrcWsId = null;
let diagPollTimer = null;

function getDefaultAiCommand() {
  return state.aiPresets[state.aiDefaultIndex]?.command || "claude";
}
function getAiPresetForCommand(cmd) {
  return state.aiPresets.find((p) => p.command === cmd) || { name: cmd, command: cmd, icon: "?" };
}
function setAiDefault(index) {
  state.aiDefaultIndex = index;
  localStorage.setItem("pty-win-ai-default", String(index));
}

// ===== xterm theme =====

const TERM_THEME = {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#aeafad",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#264f7840",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

// ===== Persistence =====

function loadFavorites() {
  try {
    const raw = localStorage.getItem("pty-win-favorites");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFavorites() {
  localStorage.setItem("pty-win-favorites", JSON.stringify(state.favorites));
}

function loadPinnedFolders() {
  try {
    const raw = localStorage.getItem("pty-win-pinned");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePinnedFolders() {
  localStorage.setItem("pty-win-pinned", JSON.stringify(state.pinnedFolders));
}

function loadExpandedPaths() {
  try {
    const raw = localStorage.getItem("pty-win-expanded");
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveExpandedPaths() {
  localStorage.setItem("pty-win-expanded", JSON.stringify([...state.expandedPaths]));
}

function loadSidebarWidth() {
  try {
    const w = localStorage.getItem("pty-win-sidebar-width");
    return w ? parseInt(w, 10) : 220;
  } catch { return 220; }
}

function saveWorkspaces() {
  // Save workspace metadata + layout (session names only, not terminal instances)
  const data = state.workspaces.map((ws) => ({
    id: ws.id,
    name: ws.name,
    customName: ws.customName || false,
    layout: ws.layout,
  }));
  localStorage.setItem("pty-win-workspaces", JSON.stringify({
    workspaces: data,
    activeWorkspaceId: state.activeWorkspaceId,
    isDashboard: state.isDashboard,
    nextId: nextWorkspaceId,
  }));
}

function loadWorkspaces() {
  try {
    const raw = localStorage.getItem("pty-win-workspaces");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveSidebarWidth(w) {
  localStorage.setItem("pty-win-sidebar-width", String(w));
}

function loadSessionMeta() {
  try {
    const raw = localStorage.getItem("pty-win-session-meta");
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw)));
  } catch { return new Map(); }
}

function saveSessionMeta() {
  const obj = {};
  for (const [name, meta] of state.sessionMeta) obj[name] = meta;
  localStorage.setItem("pty-win-session-meta", JSON.stringify(obj));
}

function rebuildPaneGroups() {
  // Preserve activeType selections across rebuilds
  const prevActive = new Map();
  for (const [g, pg] of state.paneGroups) prevActive.set(g, pg.activeType);

  state.paneGroups.clear();
  for (const [name, info] of state.sessions) {
    const group = info.group || name;
    if (!state.paneGroups.has(group)) {
      state.paneGroups.set(group, { activeType: prevActive.get(group) || "claude" });
    }
    const pg = state.paneGroups.get(group);
    if (name.endsWith("~pwsh")) {
      pg.pwsh = name;
    } else {
      pg.claude = name;
    }
  }
  // If activeType points to a dead/missing session, flip to the other
  for (const [, pg] of state.paneGroups) {
    if (pg.activeType === "pwsh" && !pg.pwsh) pg.activeType = "claude";
    if (pg.activeType === "claude" && !pg.claude) pg.activeType = "pwsh";
  }
}

// ===== WebSocket =====

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${proto}//${location.host}`);

  state.ws.onopen = () => initApp();

  state.ws.onclose = () => setTimeout(connect, 2000);

  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case "data": {
        const entry = state.terminals.get(msg.session);
        if (entry) entry.term.write(msg.payload);
        break;
      }
      case "sessions": {
        // Replace full session list (server is authoritative)
        const serverNames = new Set(msg.payload.map((s) => s.name));
        state.sessions.clear();
        for (const s of msg.payload) state.sessions.set(s.name, s);

        // Capture session metadata for recreation after restarts
        for (const s of msg.payload) {
          state.sessionMeta.set(s.name, { workingDir: s.workingDir, command: s.command });
        }
        saveSessionMeta();

        // Rebuild pane groups
        rebuildPaneGroups();

        // Collect orphaned workspace leaves (in layout but not on server)
        const serverGroups = new Set([...state.sessions.values()].map((s) => s.group || s.name));
        const orphans = new Set();
        for (const ws of state.workspaces) {
          if (!ws.layout) continue;
          for (const name of getLeafList(ws.layout)) {
            if (!serverGroups.has(name)) orphans.add(name);
          }
        }

        // Attempt to recreate orphans that have saved metadata; prune the rest
        // Orphans are group names; metadata is keyed by session name (group or group~pwsh)
        const hasMetaForGroup = (g) => state.sessionMeta.has(g) || state.sessionMeta.has(g + "~pwsh");
        const recreatable = [];
        for (const g of orphans) {
          if (state.sessionMeta.has(g)) recreatable.push(g);
          if (state.sessionMeta.has(g + "~pwsh")) recreatable.push(g + "~pwsh");
        }
        const unrecoverable = [...orphans].filter((n) => !hasMetaForGroup(n));

        // Prune leaves with no metadata (truly unknown)
        if (unrecoverable.length > 0) {
          for (const ws of state.workspaces) {
            if (!ws.layout) continue;
            const leaves = getLeafList(ws.layout);
            const alive = leaves.filter((n) => !unrecoverable.includes(n));
            if (alive.length < leaves.length) {
              ws.layout = buildBalancedTree(alive);
              updateWorkspaceTabName(ws);
            }
          }
        }

        // Recreate sessions that have metadata (async, server will re-broadcast)
        if (recreatable.length > 0) {
          recreateOrphanedSessions(recreatable);
        }


        refreshTreeRunningState();
        renderSessionsPanel();
        renderQuickAccess();
        if (state.isDashboard) renderDashboard();
        else renderActiveWorkspace();
        break;
      }
      case "status": {
        const s = state.sessions.get(msg.session);
        if (s) {
          s.status = msg.payload.status;
          s.unreadCount = msg.payload.unreadCount;
          rebuildPaneGroups();
          updatePaneStatus(msg.session);
          refreshTreeRunningState();
          renderSessionsPanel();
          renderQuickAccess();

          if (state.isDashboard) renderDashboard();

          // Auto-remove dead sessions after a brief flash
          if (msg.payload.status === "dead") {
            // Layer 4: warn if workspace has uncommitted changes
            if (msg.payload.dirtyOnExit) {
              showDirtyWarning(msg.session, msg.payload.workingDir);
            }
            setTimeout(() => autoRemoveDeadSession(msg.session), 1500);
          }
        }
        break;
      }
      case "notification": {
        const s = state.sessions.get(msg.session);
        if (s) {
          // Don't increment unreadCount here — status-change carries the authoritative count.
          // Just trigger UI refresh to show the notification.
          updatePaneStatus(msg.session);
          renderSessionsPanel();
          renderQuickAccess();

          if (state.isDashboard) renderDashboard();
        }
        break;
      }
    }
  };
}

async function initApp() {
  // Load server config for initial roots
  try {
    const res = await fetch("/api/config");
    const config = await res.json();
    for (const root of config.rootDirs || []) {
      if (!state.favorites.includes(root)) {
        state.favorites.push(root);
      }
    }
    saveFavorites();
  } catch {}

  renderTree();
  renderQuickAccess();
  renderTabs();
  if (state.isDashboard) renderDashboard();
  else renderActiveWorkspace();
}

// ===== Folder Tree =====

async function fetchChildren(path) {
  if (state.folderCache.has(path)) return state.folderCache.get(path);
  try {
    const res = await fetch(`/api/folders?path=${encodeURIComponent(path)}`);
    const entries = await res.json();
    state.folderCache.set(path, entries);
    // Add to visited for quick-open
    for (const e of entries) {
      if (e.isDir && !state.visitedFolders.find((v) => v.path === e.path)) {
        state.visitedFolders.push(e);
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function renderTree() {
  const tree = document.getElementById("folder-tree");
  tree.innerHTML = "";

  const folderCountEl = document.querySelector(".folder-count");
  if (folderCountEl) folderCountEl.textContent = state.favorites.length > 0 ? `(${state.favorites.length})` : "";

  for (const rootPath of state.favorites) {
    const rootName = rootPath.split(/[/\\]/).filter(Boolean).pop() || rootPath;
    const rootEl = document.createElement("div");
    rootEl.className = "tree-root";

    const label = document.createElement("div");
    label.className = "tree-root-label";
    label.dataset.path = normPath(rootPath);
    const expanded = state.expandedPaths.has(rootPath);

    // Arrow
    const arrow = document.createElement("span");
    arrow.className = `arrow ${expanded ? "expanded" : ""}`;
    label.appendChild(arrow);

    // Root name
    const nameSpan = document.createElement("span");
    nameSpan.className = "root-name";
    nameSpan.textContent = rootName;
    label.appendChild(nameSpan);

    // Green name for running sessions
    for (const [, s] of state.sessions) {
      if (s.status !== "dead" && normPath(s.workingDir) === label.dataset.path) {
        nameSpan.classList.add("running");
        break;
      }
    }

    // Shared right-side section (uses cached folder info, fetches async if needed)
    const rootSessionInfo = state.sessions.get(rootName);
    const rootMatchesPath = rootSessionInfo && normPath(rootSessionInfo.workingDir) === normPath(rootPath);
    const rootPwshInfo = state.sessions.get(rootName + "~pwsh");
    const rootPwshMatches = rootPwshInfo && normPath(rootPwshInfo.workingDir) === normPath(rootPath);
    const rootCacheKey = normPath(rootPath);
    const rootCached = state.folderInfoCache.get(rootCacheKey);
    appendRowActions(label, {
      identityName: rootCached?.identityName || (rootMatchesPath ? rootSessionInfo?.emcomIdentity : null) || null,
      unreadCount: rootMatchesPath ? (rootSessionInfo?.unreadCount || 0) : 0,
      workingDir: rootPath,
      folderName: rootName,
      claudeAlive: !!(rootMatchesPath && rootSessionInfo?.status !== "dead"),
      pwshAlive: !!(rootPwshMatches && rootPwshInfo?.status !== "dead"),
      claudeCommand: rootMatchesPath ? rootSessionInfo?.command : null,
      isClaudeReady: rootCached?.isClaudeReady || false,
      hasIdentity: rootCached?.hasIdentity || false,
    });
    if (!rootCached) {
      fetch(`/api/folder-info?path=${encodeURIComponent(rootPath)}`)
        .then((r) => r.json())
        .then((info) => {
          state.folderInfoCache.set(rootCacheKey, info);
          // Update indicators in-place once folder info arrives
          const slot = label.querySelector(".indicator-slot");
          if (slot) {
            const indC = slot.querySelector(".indicator.claude-ready");
            const indI = slot.querySelector(".indicator.identity");
            if (indC) { indC.classList.toggle("hidden-placeholder", !info.isClaudeReady); if (info.isClaudeReady) indC.title = "Has CLAUDE.md"; }
            if (indI) { indI.classList.toggle("hidden-placeholder", !info.hasIdentity); if (info.hasIdentity) indI.title = `Identity: ${info.identityName || "yes"}`; }
          }
          // Update identity tag
          const idTag = label.querySelector(".identity-tag");
          if (idTag && info.identityName) {
            idTag.textContent = info.identityName;
            idTag.classList.remove("hidden-placeholder");
          }
        })
        .catch(() => {});
    }

    label.onclick = () => toggleExpand(rootPath);
    label.addEventListener("contextmenu", (e) => showContextMenu(e, rootPath));
    rootEl.appendChild(label);

    const childContainer = document.createElement("div");
    childContainer.className = `tree-children ${expanded ? "expanded" : ""}`;
    childContainer.id = `children-${cssId(rootPath)}`;
    rootEl.appendChild(childContainer);

    tree.appendChild(rootEl);

    if (expanded) loadAndRenderChildren(rootPath, childContainer, 1);
  }
}

async function toggleExpand(path) {
  if (state.expandedPaths.has(path)) {
    state.expandedPaths.delete(path);
  } else {
    state.expandedPaths.add(path);
  }
  saveExpandedPaths();
  renderTree();
}

async function loadAndRenderChildren(parentPath, container, depth) {
  const entries = await fetchChildren(parentPath);
  container.innerHTML = "";

  for (const entry of entries) {
    if (!entry.isDir) continue;

    const node = document.createElement("div");

    // The clickable row
    const row = document.createElement("div");
    row.className = "tree-node";
    row.dataset.path = normPath(entry.path);
    for (const [, s] of state.sessions) {
      if (s.status !== "dead" && normPath(s.workingDir) === row.dataset.path) {
        row.classList.add("running");
        break;
      }
    }

    // Indent
    const indent = document.createElement("span");
    indent.className = "indent";
    indent.style.width = `${depth * 8}px`;
    row.appendChild(indent);

    // Arrow
    const arrow = document.createElement("span");
    const isExpanded = state.expandedPaths.has(entry.path);
    arrow.className = `arrow ${isExpanded ? "expanded" : ""}`;
    row.appendChild(arrow);

    // Folder name
    const name = document.createElement("span");
    name.className = "folder-name";
    name.textContent = entry.name;
    row.appendChild(name);

    // Shared right-side section (matches sessions panel layout)
    const sessionInfo = state.sessions.get(entry.name);
    const sessionMatchesPath = sessionInfo && normPath(sessionInfo.workingDir) === normPath(entry.path);
    const pwshInfo = state.sessions.get(entry.name + "~pwsh");
    const pwshMatchesPath = pwshInfo && normPath(pwshInfo.workingDir) === normPath(entry.path);
    appendRowActions(row, {
      identityName: entry.hasIdentity ? (entry.identityName || null) : null,
      unreadCount: sessionMatchesPath ? (sessionInfo.unreadCount || 0) : 0,
      workingDir: entry.path,
      folderName: entry.name,
      claudeAlive: !!(sessionMatchesPath && sessionInfo.status !== "dead"),
      pwshAlive: !!(pwshMatchesPath && pwshInfo.status !== "dead"),
      claudeCommand: sessionMatchesPath ? sessionInfo.command : null,
      isClaudeReady: entry.isClaudeReady,
      hasIdentity: entry.hasIdentity,
    });

    // Row click = expand/collapse
    row.onclick = () => toggleExpand(entry.path);
    row.addEventListener("contextmenu", (e) => showContextMenu(e, entry.path));

    node.appendChild(row);

    // Children container
    const childContainer = document.createElement("div");
    childContainer.className = `tree-children ${isExpanded ? "expanded" : ""}`;
    node.appendChild(childContainer);

    container.appendChild(node);

    if (isExpanded) loadAndRenderChildren(entry.path, childContainer, depth + 1);
  }
}
function normPath(p) {
  return p ? p.replace(/\\/g, "/").toLowerCase() : "";
}

function refreshTreeRunningState() {
  const running = new Set();
  const unread = new Set();
  for (const [, s] of state.sessions) {
    if (s.status !== "dead" && s.workingDir) running.add(normPath(s.workingDir));
    if (s.unreadCount > 0 && s.workingDir) unread.add(normPath(s.workingDir));
  }
  // Child folder nodes
  document.querySelectorAll(".tree-node[data-path]").forEach((node) => {
    node.classList.toggle("running", running.has(node.dataset.path));
    const dot = node.querySelector(".unread-dot");
    if (dot) dot.classList.toggle("show", unread.has(node.dataset.path));
  });
  // Root folder labels
  document.querySelectorAll(".tree-root-label[data-path]").forEach((label) => {
    const nameSpan = label.querySelector(".root-name");
    if (nameSpan) nameSpan.classList.toggle("running", running.has(label.dataset.path));
    const dot = label.querySelector(".unread-dot");
    if (dot) dot.classList.toggle("show", unread.has(label.dataset.path));
  });
}

function cssId(path) {
  return path.replace(/[^a-zA-Z0-9]/g, "_");
}

// ===== Quick Access Panel =====

function renderQuickAccess() {
  const panel = document.getElementById("quick-access-panel");
  if (!panel) return;
  panel.innerHTML = "";

  if (state.pinnedFolders.length === 0) return;

  for (const folderPath of state.pinnedFolders) {
    const name = folderPath.split(/[/\\]/).filter(Boolean).pop();
    const np = normPath(folderPath);

    const row = document.createElement("div");
    row.className = "quick-access-row";

    // Status dot (mirrors Sessions panel)
    const claudeStatusSession = [...state.sessions.values()].find(
      (s) => normPath(s.workingDir) === np && s.status !== "dead" && s.command !== "pwsh"
    );
    const pwshStatusSession = [...state.sessions.values()].find(
      (s) => normPath(s.workingDir) === np && s.status !== "dead" && s.command === "pwsh"
    );
    const qaStatus = claudeStatusSession?.status === "busy" || pwshStatusSession?.status === "busy"
      ? "busy" : claudeStatusSession?.status === "starting" || pwshStatusSession?.status === "starting"
      ? "starting" : claudeStatusSession || pwshStatusSession ? "idle" : "dead";
    const dot = document.createElement("span");
    dot.className = `status-dot ${qaStatus}`;
    row.appendChild(dot);

    // Name — click to focus/open
    const label = document.createElement("span");
    label.className = "quick-access-name";
    label.textContent = name;
    label.onclick = () => {
      const existing = [...state.sessions.values()].find(
        (s) => normPath(s.workingDir) === np && s.status !== "dead"
      );
      if (existing) focusExistingSession(existing.name);
      else openFolder(folderPath, name);
    };
    row.appendChild(label);

    // Action pills — same as sessions/folders panels
    const claudeSession = [...state.sessions.values()].find(
      (s) => normPath(s.workingDir) === np && s.status !== "dead" && s.command !== "pwsh"
    );
    const pwshSession = [...state.sessions.values()].find(
      (s) => normPath(s.workingDir) === np && s.status !== "dead" && s.command === "pwsh"
    );
    const cached = state.folderInfoCache.get(np);

    appendRowActions(row, {
      identityName: claudeSession?.emcomIdentity || cached?.identityName || null,
      unreadCount: claudeSession?.unreadCount || 0,
      workingDir: folderPath,
      folderName: name,
      claudeAlive: !!claudeSession,
      pwshAlive: !!pwshSession,
      claudeCommand: claudeSession?.command || null,
      isClaudeReady: cached?.isClaudeReady || false,
      hasIdentity: cached?.hasIdentity || false,
      onKill: (claudeSession || pwshSession) ? () => {
        if (claudeSession) killSession(claudeSession.name);
        if (pwshSession) killSession(pwshSession.name);
      } : null,
    });

    // Fetch folder info if not cached
    if (!cached) {
      fetch(`/api/folder-info?path=${encodeURIComponent(folderPath)}`)
        .then((r) => r.json())
        .then((info) => {
          state.folderInfoCache.set(np, info);
          const slot = row.querySelector(".indicator-slot");
          if (slot) {
            const indC = slot.querySelector(".indicator.claude-ready");
            const indI = slot.querySelector(".indicator.identity");
            if (indC) { indC.classList.toggle("hidden-placeholder", !info.isClaudeReady); if (info.isClaudeReady) indC.title = "Has CLAUDE.md"; }
            if (indI) { indI.classList.toggle("hidden-placeholder", !info.hasIdentity); if (info.hasIdentity) indI.title = `Identity: ${info.identityName || "yes"}`; }
          }
        })
        .catch(() => {});
    }

    // Right-click → context menu
    row.addEventListener("contextmenu", (e) => showContextMenu(e, folderPath));

    panel.appendChild(row);
  }
}

// ===== Sessions Panel =====

function renderSessionsPanel() {
  const list = document.getElementById("sessions-list");
  const countEl = document.querySelector(".session-count");
  if (!list) return;

  // Build list of active groups
  const groups = [];
  for (const [group, pg] of state.paneGroups) {
    const claudeInfo = pg.claude ? state.sessions.get(pg.claude) : null;
    const pwshInfo = pg.pwsh ? state.sessions.get(pg.pwsh) : null;
    const claudeAlive = claudeInfo && claudeInfo.status !== "dead";
    const pwshAlive = pwshInfo && pwshInfo.status !== "dead";
    if (!claudeAlive && !pwshAlive) continue;
    const workingDir = (claudeInfo || pwshInfo).workingDir;
    groups.push({ group, pg, claudeInfo, pwshInfo, claudeAlive, pwshAlive, workingDir });
  }

  if (countEl) countEl.textContent = groups.length > 0 ? `(${groups.length})` : "";

  list.innerHTML = "";
  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sessions-empty";
    empty.textContent = "No sessions";
    list.appendChild(empty);
    return;
  }

  for (const g of groups) {
    const row = document.createElement("div");
    row.className = `session-row ${g.group === state.focusedPane ? "active" : ""}`;
    row.dataset.group = g.group;

    // Status dot — worst-of status across group
    const bestStatus = g.claudeAlive && g.claudeInfo.status === "busy" || g.pwshAlive && g.pwshInfo.status === "busy"
      ? "busy" : g.claudeAlive && g.claudeInfo.status === "starting" || g.pwshAlive && g.pwshInfo.status === "starting"
      ? "starting" : "idle";
    const dot = document.createElement("span");
    dot.className = `status-dot ${bestStatus}`;
    row.appendChild(dot);

    // Name
    const name = document.createElement("span");
    name.className = "session-name";
    name.textContent = g.group;
    row.appendChild(name);

    // Shared right-side section
    const totalUnread = (g.claudeAlive ? g.claudeInfo.unreadCount || 0 : 0)
      + (g.pwshAlive ? g.pwshInfo.unreadCount || 0 : 0);
    const cacheKey = normPath(g.workingDir);
    const cached = state.folderInfoCache.get(cacheKey);
    appendRowActions(row, {
      identityName: (g.claudeInfo || g.pwshInfo)?.emcomIdentity || null,
      unreadCount: totalUnread,
      workingDir: g.workingDir,
      folderName: g.group,
      claudeAlive: g.claudeAlive,
      pwshAlive: g.pwshAlive,
      claudeCommand: g.claudeAlive ? g.claudeInfo.command : null,
      isClaudeReady: cached?.isClaudeReady || false,
      hasIdentity: cached?.hasIdentity || false,
      onKill: () => {
        if (g.claudeAlive) killSession(g.pg.claude);
        if (g.pwshAlive) killSession(g.pg.pwsh);
      },
    });
    // Fetch folder info if not cached (for indicator dots)
    if (!cached) {
      fetch(`/api/folder-info?path=${encodeURIComponent(g.workingDir)}`)
        .then((r) => r.json())
        .then((info) => {
          state.folderInfoCache.set(cacheKey, info);
          // Update indicators in-place once folder info arrives
          const slot = row.querySelector(".indicator-slot");
          if (slot) {
            const indC = slot.querySelector(".indicator.claude-ready");
            const indI = slot.querySelector(".indicator.identity");
            if (indC) { indC.classList.toggle("hidden-placeholder", !info.isClaudeReady); if (info.isClaudeReady) indC.title = "Has CLAUDE.md"; }
            if (indI) { indI.classList.toggle("hidden-placeholder", !info.hasIdentity); if (info.hasIdentity) indI.title = `Identity: ${info.identityName || "yes"}`; }
          }
        })
        .catch(() => {});
    }

    // Click row → focus active session
    const activeName = g.pg.activeType === "pwsh" && g.pwshAlive ? g.pg.pwsh
      : g.claudeAlive ? g.pg.claude : g.pg.pwsh;
    row.onclick = () => focusExistingSession(activeName);
    row.addEventListener("contextmenu", (e) => showContextMenu(e, g.workingDir));
    list.appendChild(row);
  }
}

function appendRowActions(container, opts) {
  const { identityName, unreadCount, workingDir, folderName,
    claudeAlive, pwshAlive, claudeCommand, isClaudeReady, hasIdentity, onKill } = opts;

  // Identity tag (always rendered for column alignment)
  const idTag = document.createElement("span");
  idTag.className = `identity-tag ${identityName ? "" : "hidden-placeholder"}`;
  idTag.textContent = identityName ? identityName : "@";
  container.appendChild(idTag);

  // Unread badge (always rendered)
  const badge = document.createElement("span");
  badge.className = `unread-badge ${unreadCount > 0 ? "" : "hidden-placeholder"}`;
  badge.textContent = unreadCount > 0 ? `(${unreadCount})` : "(0)";
  container.appendChild(badge);

  // AI tag
  const aiPreset = claudeAlive && claudeCommand ? getAiPresetForCommand(claudeCommand) : state.aiPresets[state.aiDefaultIndex];
  const cTag = document.createElement("span");
  cTag.className = `cmd-tag ${claudeAlive ? "alive" : "absent"}`;
  cTag.textContent = aiPreset.icon;
  if (claudeAlive) {
    cTag.title = `${aiPreset.name}: running — click to send message`;
    cTag.onclick = (e) => { e.stopPropagation(); showQuickMessageInput(folderName, cTag); };
  } else {
    cTag.title = `Start ${aiPreset.name} (right-click for options)`;
    cTag.onclick = (e) => { e.stopPropagation(); openFolder(workingDir, folderName, getDefaultAiCommand()); };
    cTag.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showAiTagContextMenu(e, workingDir, folderName); };
  }
  container.appendChild(cTag);

  // PowerShell tag
  const pTag = document.createElement("span");
  pTag.className = `cmd-tag pwsh ${pwshAlive ? "alive" : "absent"}`;
  pTag.textContent = ">_";
  pTag.title = pwshAlive ? "PowerShell: running" : "Start PowerShell";
  if (!pwshAlive) {
    pTag.onclick = (e) => { e.stopPropagation(); openFolder(workingDir, folderName, "pwsh"); };
  }
  container.appendChild(pTag);

  // VS Code tag
  const codeTag = document.createElement("span");
  codeTag.className = "cmd-tag code";
  codeTag.textContent = "\u003c/\u003e";
  codeTag.title = "Open in VS Code (click to launch)";
  codeTag.onclick = (e) => {
    e.stopPropagation();
    // Exit Fullscreen API mode (server handles F11/minimize via Win32)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    fetch("/api/open-editor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: workingDir }),
    });
  };
  container.appendChild(codeTag);

  // Indicator slot (always render both dots)
  const indicatorSlot = document.createElement("span");
  indicatorSlot.className = "indicator-slot";
  container.appendChild(indicatorSlot);

  const indClaude = document.createElement("span");
  indClaude.className = `indicator claude-ready ${isClaudeReady ? "" : "hidden-placeholder"}`;
  indClaude.textContent = "\u25c6";
  if (isClaudeReady) indClaude.title = "Has CLAUDE.md";
  indicatorSlot.appendChild(indClaude);

  const indIdentity = document.createElement("span");
  indIdentity.className = `indicator identity ${hasIdentity ? "" : "hidden-placeholder"}`;
  indIdentity.textContent = "\u25cf";
  if (hasIdentity) indIdentity.title = `Identity: ${identityName || "yes"}`;
  indicatorSlot.appendChild(indIdentity);

  // Kill button — always render as spacer to keep column alignment
  const killBtn = document.createElement("button");
  killBtn.className = "kill-btn";
  killBtn.textContent = "\u00d7";
  if (onKill) {
    killBtn.title = "Kill session";
    killBtn.onclick = (e) => { e.stopPropagation(); onKill(); };
  } else {
    killBtn.style.pointerEvents = "none";
  }
  container.appendChild(killBtn);
}

// Sessions panel collapse toggle
(() => {
  const header = document.getElementById("sessions-panel-header");
  const body = document.getElementById("sessions-list");
  const arrow = header?.querySelector(".arrow");
  const stored = localStorage.getItem("pty-win-sessions-expanded");
  if (stored === "false") {
    body?.classList.remove("expanded");
    arrow?.classList.remove("expanded");
  }
  header?.addEventListener("click", () => {
    const isExpanded = body.classList.toggle("expanded");
    arrow.classList.toggle("expanded", isExpanded);
    localStorage.setItem("pty-win-sessions-expanded", isExpanded);
  });
})();

// Folders panel collapse toggle
(() => {
  const header = document.getElementById("folders-panel-header");
  const body = document.getElementById("folder-tree");
  const arrow = header?.querySelector(".arrow");
  const stored = localStorage.getItem("pty-win-folders-expanded");
  if (stored === "false") {
    body?.classList.remove("expanded");
    arrow?.classList.remove("expanded");
  }
  header?.addEventListener("click", (e) => {
    if (e.target.closest(".panel-actions")) return; // don't toggle when clicking buttons
    const isExpanded = body.classList.toggle("expanded");
    arrow.classList.toggle("expanded", isExpanded);
    localStorage.setItem("pty-win-folders-expanded", isExpanded);
  });
})();

// ===== Session Recreation =====

let recreationInProgress = false;

async function recreateOrphanedSessions(names) {
  if (recreationInProgress) return;
  recreationInProgress = true;

  const STARTUP_STAGGER_MS = 7000;

  const mainEl = document.getElementById("main");
  const charW = 7.6, charH = 18;
  const availW = (mainEl?.clientWidth || 800) - 4;
  const availH = (mainEl?.clientHeight || 600) - 35 - 26 - 22 - 4;
  const cols = Math.max(80, Math.floor(availW / charW));
  const rows = Math.max(24, Math.floor(availH / charH));

  // Fetch repo root for each session, group by repo
  const repoGroups = new Map(); // repoRoot -> [name, ...]
  await Promise.all(names.map(async (name) => {
    const meta = state.sessionMeta.get(name);
    if (!meta) return;
    let repoRoot = null;
    try {
      const r = await fetch(`/api/repo-root?path=${encodeURIComponent(meta.workingDir)}`);
      if (r.ok) repoRoot = (await r.json()).repoRoot;
    } catch {}
    const key = repoRoot || meta.workingDir;
    if (!repoGroups.has(key)) repoGroups.set(key, []);
    repoGroups.get(key).push(name);
  }));

  const groups = [...repoGroups.values()];

  async function launchGroup(group) {
    for (const name of group) {
      const meta = state.sessionMeta.get(name);
      if (!meta) continue;
      try {
        const isClaude = !meta.command || meta.command === "claude";
        const body = { workingDir: meta.workingDir, cols, rows };
        if (meta.command && meta.command !== "claude") body.command = meta.command;
        if (isClaude) body.args = ["--continue"];
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) { console.warn(`Failed to recreate session "${name}":`, await res.text()); pruneFailedSession(name); }
      } catch (err) {
        console.warn(`Error recreating session "${name}":`, err);
        pruneFailedSession(name);
      }
    }
  }

  // Launch groups staggered by STARTUP_STAGGER_MS
  for (let i = 0; i < groups.length; i++) {
    if (i === 0) {
      await launchGroup(groups[i]);
    } else {
      setTimeout(() => launchGroup(groups[i]), i * STARTUP_STAGGER_MS);
    }
  }

  recreationInProgress = false;
}

function pruneFailedSession(name) {
  state.sessionMeta.delete(name);
  saveSessionMeta();
  for (const ws of state.workspaces) {
    if (ws.layout && treeContains(ws.layout, name)) {
      const leaves = getLeafList(ws.layout).filter((n) => n !== name);
      ws.layout = buildBalancedTree(leaves);
      updateWorkspaceTabName(ws);
    }
  }
  saveWorkspaces();
  if (state.isDashboard) renderDashboard();
  else renderActiveWorkspace();
}

// ===== Open Folder =====

/** Get the active workspace, or the most recent one, or create a new one */
function getOrCreateActiveWorkspace() {
  // If we're on a workspace tab already, use it
  const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (active) return active;

  // If on dashboard but workspaces exist, use the last one
  if (state.workspaces.length > 0) return state.workspaces[state.workspaces.length - 1];

  // No workspaces at all — create one
  return createWorkspace("Workspace 1");
}

/** Open a folder as a session, optionally forcing a new workspace */
async function openFolder(folderPath, folderName, command, newWorkspace = false, args = []) {
  const baseName = folderName || folderPath.split(/[/\\]/).filter(Boolean).pop();
  const isPwsh = command === "pwsh";
  const sessionName = isPwsh ? baseName + "~pwsh" : baseName;

  // If this exact session exists and alive, just focus it
  const existing = state.sessions.get(sessionName);
  if (existing && existing.status !== "dead") {
    // Switch the pane group to show this type
    const pg = state.paneGroups.get(baseName);
    if (pg) pg.activeType = isPwsh ? "pwsh" : "claude";
    focusExistingSession(baseName);
    renderActiveWorkspace();
    return;
  }

  // If dead session with same name exists, clean it up first
  if (existing && existing.status === "dead") {
    await fetch(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: "DELETE" }).catch(() => {});
    state.sessions.delete(sessionName);
    const entry = state.terminals.get(sessionName);
    if (entry) {
      entry.resizeObserver?.disconnect();
      entry.term.dispose();
      entry.wrapperEl?.remove();
      state.terminals.delete(sessionName);
    }
  }

  // Create session
  try {
    // Estimate initial terminal size from the workspace area
    const mainEl = document.getElementById("main");
    const charW = 7.6, charH = 18; // approximate character dimensions for Consolas 13px
    const availW = (mainEl?.clientWidth || 800) - 4; // minus pane borders
    const availH = (mainEl?.clientHeight || 600) - 35 - 26 - 22 - 4; // minus tabbar, topbar, statusbar, borders
    const cols = Math.max(80, Math.floor(availW / charW));
    const rows = Math.max(24, Math.floor(availH / charH));

    const body = { workingDir: folderPath, cols, rows };
    if (command) body.command = command;
    else body.command = getDefaultAiCommand();
    if (args.length) body.args = args;

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to create session");
      return;
    }

    const data = await res.json();

    // Check if a sibling session already has a pane in a workspace
    const siblingWs = findWorkspaceContaining(baseName);
    if (siblingWs && isPwsh) {
      // Sibling claude session already has a pane — just switch toggle to pwsh
      const pg = state.paneGroups.get(baseName) || { activeType: "pwsh" };
      pg.pwsh = sessionName;
      pg.activeType = "pwsh";
      state.paneGroups.set(baseName, pg);
      switchToWorkspace(siblingWs.id);
      renderActiveWorkspace();
      focusPane(baseName);
      return;
    }
    if (siblingWs && !isPwsh) {
      // Sibling pwsh session already has a pane — switch toggle to claude
      const pg = state.paneGroups.get(baseName) || { activeType: "claude" };
      pg.claude = sessionName;
      pg.activeType = "claude";
      state.paneGroups.set(baseName, pg);
      switchToWorkspace(siblingWs.id);
      renderActiveWorkspace();
      focusPane(baseName);
      return;
    }

    // No existing pane — tile into workspace using the group name (baseName)
    let ws = newWorkspace ? createWorkspace(baseName) : getOrCreateActiveWorkspace();
    addSessionToWorkspace(ws.id, baseName);
    switchToWorkspace(ws.id);
    renderActiveWorkspace();
    focusPane(baseName);
    updateWorkspaceTabName(ws);
  } catch (err) {
    alert("Failed to create session");
  }
}

function focusExistingSession(name) {
  // Map session name to group name (pane leaf name)
  const groupName = name.replace(/~pwsh$/, "");
  // If focusing a pwsh session, switch the pane toggle
  if (name.endsWith("~pwsh")) {
    const pg = state.paneGroups.get(groupName);
    if (pg) pg.activeType = "pwsh";
  }
  // Find workspace containing this group's pane
  const ws = findWorkspaceContaining(groupName);
  if (ws) {
    // Set focusedPane directly so switchToWorkspace picks it up
    state.focusedPane = groupName;
    ws.lastFocusedPane = groupName;
    if (ws.id === state.activeWorkspaceId) {
      // Already on this workspace — just focus the pane, no full switch needed
      renderActiveWorkspace();
      focusPane(groupName);
      requestAnimationFrame(() => {
        const pg = state.paneGroups.get(groupName);
        const sName = pg ? (pg.activeType === "pwsh" ? pg.pwsh : pg.claude) : groupName;
        const entry = state.terminals.get(sName || groupName);
        if (entry) entry.term.focus();
      });
    } else {
      switchToWorkspace(ws.id);
    }
  } else {
    // Not in any workspace — tile into active workspace
    const activeWs = getOrCreateActiveWorkspace();
    addSessionToWorkspace(activeWs.id, groupName);
    state.focusedPane = groupName;
    activeWs.lastFocusedPane = groupName;
    switchToWorkspace(activeWs.id);
    updateWorkspaceTabName(activeWs);
  }
}

/** Update workspace tab name based on its sessions */
function updateWorkspaceTabName(ws) {
  if (ws.customName) return; // user renamed — don't override
  const leaves = ws.layout ? getLeafList(ws.layout) : [];
  if (leaves.length === 0) return;
  if (leaves.length === 1) {
    ws.name = leaves[0];
  } else if (leaves.length <= 3) {
    ws.name = leaves.join(" + ");
  } else {
    ws.name = leaves.slice(0, 2).join(" + ") + ` +${leaves.length - 2}`;
  }
  renderTabs();
}

// ===== Context Menu =====

function showQuickMessageInput(sessionName, anchorEl) {
  // Remove any existing popup
  document.getElementById("quick-msg-popup")?.remove();

  const popup = document.createElement("div");
  popup.id = "quick-msg-popup";
  popup.className = "quick-msg-popup";

  const title = document.createElement("div");
  title.className = "quick-msg-title";
  title.textContent = `→ ${sessionName}`;
  popup.appendChild(title);

  const row = document.createElement("div");
  row.className = "quick-msg-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "quick-msg-input";
  input.placeholder = "Type a message…";

  const sendBtn = document.createElement("button");
  sendBtn.className = "quick-msg-send";
  sendBtn.textContent = "Send";

  row.appendChild(input);
  row.appendChild(sendBtn);
  popup.appendChild(row);
  document.body.appendChild(popup);

  // Position below the anchor element
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
  popup.style.top = `${rect.bottom + 4}px`;

  input.focus();

  const dismiss = () => popup.remove();

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    input.disabled = true;
    fetch(`/api/sessions/${encodeURIComponent(sessionName)}/quick-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          title.textContent = "sent ✓";
          title.style.color = "#4ec94e";
          setTimeout(dismiss, 1200);
        } else {
          title.textContent = `error: ${data.error || "failed"}`;
          title.style.color = "#ff6060";
          sendBtn.disabled = false;
          input.disabled = false;
          input.focus();
        }
      })
      .catch((err) => {
        title.textContent = `error: ${err.message}`;
        title.style.color = "#ff6060";
        sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
      });
  };

  sendBtn.onclick = send;
  input.onkeydown = (e) => {
    if (e.key === "Enter") send();
    if (e.key === "Escape") dismiss();
  };

  // Click outside to dismiss
  const outside = (e) => {
    if (!popup.contains(e.target)) { dismiss(); document.removeEventListener("mousedown", outside); }
  };
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
}

function showContextMenu(e, path) {
  e.preventDefault();
  e.stopPropagation();
  state.ctxTarget = path;

  const menu = document.getElementById("context-menu");
  const isFav = state.favorites.includes(path);

  menu.querySelector('[data-action="fav-add"]').classList.toggle("ctx-disabled", isFav);
  menu.querySelector('[data-action="fav-remove"]').classList.toggle("ctx-disabled", !isFav);

  const isPinned = state.pinnedFolders.includes(path);
  menu.querySelector('[data-action="pin-add"]').classList.toggle("ctx-disabled", isPinned);
  menu.querySelector('[data-action="pin-remove"]').classList.toggle("ctx-disabled", !isPinned);

  // Hide separator only when both pin items are disabled (nothing meaningful to show)
  const pinSep = menu.querySelector(".ctx-sep-pin");
  if (pinSep) pinSep.style.display = "";

  // Show "Force idle" only when a busy AI session exists at this path
  const np = normPath(path);
  const aiCommands = new Set(state.aiPresets.map((p) => p.command));
  const hasBusyAI = [...state.sessions.values()].some(
    (s) => aiCommands.has(s.command) && s.status === "busy" && normPath(s.workingDir) === np
  );
  menu.querySelector('[data-action="force-idle"]').style.display = hasBusyAI ? "" : "none";

  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.classList.remove("hidden");
}

document.addEventListener("click", () => {
  document.getElementById("context-menu").classList.add("hidden");
});

document.getElementById("context-menu").addEventListener("click", async (e) => {
  const item = e.target.closest(".ctx-item");
  const action = item?.dataset.action;
  if (!action || !state.ctxTarget || item.classList.contains("ctx-disabled")) return;

  const path = state.ctxTarget;
  const name = path.split(/[/\\]/).filter(Boolean).pop();

  switch (action) {
    case "open":
      openFolder(path, name);
      break;
    case "open-new-ws": {
      openFolder(path, name, undefined, true);
      break;
    }
    case "open-cmd": {
      const cmd = prompt("Command to run:", "cmd.exe");
      if (cmd) openFolder(path, name, cmd);
      break;
    }
    case "force-idle": {
      const fnp = normPath(path);
      const aiCmds = new Set(state.aiPresets.map((p) => p.command));
      for (const [sName, s] of state.sessions) {
        if (aiCmds.has(s.command) && s.status === "busy" && normPath(s.workingDir) === fnp) {
          fetch(`/api/sessions/${encodeURIComponent(sName)}/force-idle`, { method: "POST" });
        }
      }
      break;
    }
    case "new-folder": {
      const folderName = prompt("New folder name:");
      if (!folderName?.trim()) break;
      const trimmed = folderName.trim();
      if (/[/\\:*?"<>|]/.test(trimmed)) { alert("Invalid folder name. Avoid: / \\ : * ? \" < > |"); break; }
      try {
        const res = await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentPath: path, name: trimmed }),
        });
        if (!res.ok) { const err = await res.json(); alert(err.error || "Failed to create folder"); break; }
        state.folderCache.delete(path);
        state.expandedPaths.add(path);
        renderTree();
      } catch (err) { alert("Failed to create folder: " + err.message); }
      break;
    }
    case "fav-add":
      if (!state.favorites.includes(path)) {
        state.favorites.push(path);
        saveFavorites();
        renderTree();
      }
      break;
    case "fav-remove": {
      const idx = state.favorites.indexOf(path);
      if (idx !== -1) {
        state.favorites.splice(idx, 1);
        saveFavorites();
        renderTree();
      }
      break;
    }
    case "pin-add":
      if (!state.pinnedFolders.includes(path)) {
        state.pinnedFolders.push(path);
        savePinnedFolders();
        renderQuickAccess();
      }
      break;
    case "pin-remove": {
      const pidx = state.pinnedFolders.indexOf(path);
      if (pidx !== -1) {
        state.pinnedFolders.splice(pidx, 1);
        savePinnedFolders();
        renderQuickAccess();
      }
      break;
    }
  }

  document.getElementById("context-menu").classList.add("hidden");
});

// ===== Quick-Open (Ctrl+P) =====

function openQuickOpen() {
  const overlay = document.getElementById("quick-open");
  const input = document.getElementById("quick-open-input");
  overlay.classList.remove("hidden");
  input.value = "";
  input.focus();
  renderQuickOpenResults("");
}

function closeQuickOpen() {
  document.getElementById("quick-open").classList.add("hidden");
}

function renderQuickOpenResults(query) {
  const container = document.getElementById("quick-open-results");
  container.innerHTML = "";

  const q = query.toLowerCase();
  const matches = state.visitedFolders
    .filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
    .slice(0, 20);

  for (let i = 0; i < matches.length; i++) {
    const f = matches[i];
    const row = document.createElement("div");
    row.className = `qo-result ${i === 0 ? "selected" : ""}`;
    row.dataset.idx = String(i);

    const isRunning = state.sessions.has(f.name);

    row.innerHTML = `
      <span class="qo-name">${f.name}</span>
      <span class="qo-path">${f.path}</span>
      ${f.identityName ? `<span class="qo-indicator identity">\u25cf ${f.identityName}</span>` : ""}
      ${f.isClaudeReady ? `<span class="qo-indicator" style="color: var(--claude-ready)">\u25c6</span>` : ""}
      ${isRunning ? `<span class="qo-indicator running">running</span>` : ""}
    `;

    row.onclick = () => {
      closeQuickOpen();
      openFolder(f.path, f.name);
    };

    container.appendChild(row);
  }
}

document.getElementById("quick-open-input").addEventListener("input", (e) => {
  renderQuickOpenResults(e.target.value);
});

document.getElementById("quick-open-input").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeQuickOpen(); return; }
  if (e.key === "Enter") {
    const selected = document.querySelector(".qo-result.selected");
    if (selected) selected.click();
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const results = [...document.querySelectorAll(".qo-result")];
    const idx = results.findIndex((r) => r.classList.contains("selected"));
    results.forEach((r) => r.classList.remove("selected"));
    const newIdx = e.key === "ArrowDown"
      ? Math.min(idx + 1, results.length - 1)
      : Math.max(idx - 1, 0);
    if (results[newIdx]) results[newIdx].classList.add("selected");
  }
});

document.getElementById("quick-open").addEventListener("click", (e) => {
  if (e.target === document.getElementById("quick-open")) closeQuickOpen();
});

// ===== Sidebar Toggle =====

function toggleSidebar() {
  state.sidebarVisible = !state.sidebarVisible;
  document.getElementById("sidebar").classList.toggle("hidden", !state.sidebarVisible);
  document.getElementById("sidebar-strip").classList.toggle("hidden", state.sidebarVisible);
  // Refit terminals
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (ws?.layout) requestAnimationFrame(() => fitAllTerminals(ws.layout));
}

document.getElementById("btn-collapse").onclick = toggleSidebar;
document.getElementById("btn-expand").onclick = toggleSidebar;

function refreshTree() { state.folderCache.clear(); renderTree(); }
document.getElementById("btn-refresh").onclick = refreshTree;

document.getElementById("btn-collapse-all").onclick = () => {
  state.expandedPaths.clear();
  saveExpandedPaths();
  renderTree();
};

// Sidebar resize handle
(() => {
  const handle = document.getElementById("sidebar-resize-handle");
  const sidebar = document.getElementById("sidebar");
  if (!handle || !sidebar) return;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (e) => {
      const newWidth = Math.max(100, Math.min(500, e.clientX));
      sidebar.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveSidebarWidth(parseInt(sidebar.style.width, 10));
      // Refit terminals after sidebar resize
      const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      if (ws?.layout) requestAnimationFrame(() => fitAllTerminals(ws.layout));
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
})();

// ===== Add root =====

document.getElementById("btn-add-root").onclick = () => {
  const path = prompt("Enter folder path to add as root:");
  if (path && !state.favorites.includes(path)) {
    state.favorites.push(path);
    saveFavorites();
    state.expandedPaths.add(path);
    renderTree();
  }
};

// ===== Workspaces =====

function createWorkspace(name) {
  const id = `ws-${nextWorkspaceId++}`;
  const ws = { id, name: name || `Workspace ${nextWorkspaceId - 1}`, layout: null };
  state.workspaces.push(ws);
  renderTabs();
  return ws;
}

function switchToWorkspace(id) {
  // Save focused pane for current workspace
  if (state.activeWorkspaceId) {
    const prevWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    if (prevWs) prevWs.lastFocusedPane = state.focusedPane;
  }

  stopDiagPoll();
  state.activeWorkspaceId = id;
  state.isDashboard = false;
  state.isDiag = false;

  // Restore focused pane for target workspace
  const ws = state.workspaces.find((w) => w.id === id);
  if (ws?.lastFocusedPane && ws.layout && treeContains(ws.layout, ws.lastFocusedPane)) {
    state.focusedPane = ws.lastFocusedPane;
  } else if (ws?.layout) {
    const leaves = getLeafList(ws.layout);
    state.focusedPane = leaves.length > 0 ? leaves[0] : null;
  }

  renderTabs();
  renderActiveWorkspace();
  if (state.focusedPane) {
    focusPane(state.focusedPane);
    // Terminal DOM needs a frame to be ready for keyboard focus
    requestAnimationFrame(() => {
      const pg = state.paneGroups.get(state.focusedPane);
      const name = pg ? (pg.activeType === "pwsh" ? pg.pwsh : pg.claude) : state.focusedPane;
      const entry = state.terminals.get(name || state.focusedPane);
      if (entry) entry.term.focus();
    });
  }
}

function stopDiagPoll() {
  if (diagPollTimer) { clearInterval(diagPollTimer); diagPollTimer = null; }
}

function switchToDashboard() {
  stopDiagPoll();
  state.activeWorkspaceId = null;
  state.isDashboard = true;
  state.isDiag = false;
  renderTabs();
  renderDashboard();
}

function switchToDiag() {
  stopDiagPoll();
  state.activeWorkspaceId = null;
  state.isDashboard = false;
  state.isDiag = true;
  renderTabs();
  renderDiag();
  diagPollTimer = setInterval(renderDiag, 5000);
}

function findWorkspaceContaining(sessionName) {
  for (const ws of state.workspaces) {
    if (ws.layout && treeContains(ws.layout, sessionName)) return ws;
  }
  return null;
}

function treeContains(node, sessionName) {
  if (node.type === "leaf") return node.session === sessionName;
  return treeContains(node.children[0], sessionName) || treeContains(node.children[1], sessionName);
}

function removeWorkspace(id) {
  const idx = state.workspaces.findIndex((w) => w.id === id);
  if (idx === -1) return;
  state.workspaces.splice(idx, 1);
  if (state.activeWorkspaceId === id) switchToDashboard();
  renderTabs();
}

// ===== Tabs =====

function renderTabs() {
  saveWorkspaces();
  const tabsEl = document.getElementById("tabs");
  tabsEl.innerHTML = "";

  const dashTab = document.createElement("div");
  dashTab.className = `tab ${state.isDashboard ? "active" : ""}`;
  dashTab.textContent = "Dashboard";
  dashTab.onclick = () => switchToDashboard();
  tabsEl.appendChild(dashTab);

  const diagTab = document.createElement("div");
  diagTab.className = `tab ${state.isDiag ? "active" : ""}`;
  diagTab.textContent = "Diag";
  diagTab.onclick = () => switchToDiag();
  tabsEl.appendChild(diagTab);

  for (const ws of state.workspaces) {
    const tab = document.createElement("div");
    tab.className = `tab ${ws.id === state.activeWorkspaceId ? "active" : ""}`;

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = ws.name;
    tab.appendChild(label);

    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "\u00d7";
    close.onclick = (e) => { e.stopPropagation(); removeWorkspace(ws.id); };
    tab.appendChild(close);

    // Layout preset button (active tab with 2+ panes only)
    if (ws.id === state.activeWorkspaceId && ws.layout && getLeafList(ws.layout).length >= 2) {
      const layoutBtn = document.createElement("span");
      layoutBtn.className = "tab-layout-btn";
      layoutBtn.title = "Layout presets";
      layoutBtn.textContent = "\u229e"; // ⊞
      layoutBtn.onclick = (e) => showLayoutPresetsMenu(e, ws);
      tab.appendChild(layoutBtn);
    }

    // Drag-to-reorder
    tab.draggable = true;
    tab.addEventListener("dragstart", (e) => {
      dragSrcWsId = ws.id;
      tab.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    tab.addEventListener("dragend", () => {
      dragSrcWsId = null;
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("drag-over-left", "drag-over-right", "dragging"));
    });
    tab.addEventListener("dragover", (e) => {
      if (!dragSrcWsId || dragSrcWsId === ws.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = tab.getBoundingClientRect();
      const isLeft = e.clientX < rect.left + rect.width / 2;
      tab.classList.toggle("drag-over-left", isLeft);
      tab.classList.toggle("drag-over-right", !isLeft);
    });
    tab.addEventListener("dragleave", () => {
      tab.classList.remove("drag-over-left", "drag-over-right");
    });
    tab.addEventListener("drop", (e) => {
      if (!dragSrcWsId || dragSrcWsId === ws.id) return;
      e.preventDefault();
      const rect = tab.getBoundingClientRect();
      const isLeft = e.clientX < rect.left + rect.width / 2;
      const srcIdx = state.workspaces.findIndex((w) => w.id === dragSrcWsId);
      const [removed] = state.workspaces.splice(srcIdx, 1);
      const tgtIdx = state.workspaces.findIndex((w) => w.id === ws.id);
      state.workspaces.splice(isLeft ? tgtIdx : tgtIdx + 1, 0, removed);
      dragSrcWsId = null;
      renderTabs();
    });

    // Single-click delayed to allow double-click to cancel it
    let clickTimer = null;
    tab.onclick = () => {
      if (clickTimer) return; // already pending
      clickTimer = setTimeout(() => {
        clickTimer = null;
        switchToWorkspace(ws.id);
      }, 250);
    };

    // Double-click to rename
    label.ondblclick = (e) => {
      e.stopPropagation();
      // Cancel the pending single-click
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }

      const input = document.createElement("input");
      input.className = "tab-rename";
      input.value = ws.name;
      input.style.width = `${Math.max(60, ws.name.length * 8)}px`;
      label.replaceWith(input);
      input.focus();
      input.select();

      const finish = () => {
        const newName = input.value.trim() || ws.name;
        ws.name = newName;
        ws.customName = true;
        renderTabs();
      };
      input.onblur = finish;
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
        if (ev.key === "Escape") { input.value = ws.name; input.blur(); }
      };
    };

    tabsEl.appendChild(tab);
  }

  // New workspace button — inline after last tab
  const addBtn = document.createElement("button");
  addBtn.id = "btn-new-workspace";
  addBtn.title = "New workspace";
  addBtn.textContent = "+";
  addBtn.onclick = () => { const ws = createWorkspace(null); switchToWorkspace(ws.id); };
  tabsEl.appendChild(addBtn);
}

// ===== Tiling =====

function addSessionToWorkspace(workspaceId, sessionName) {
  const ws = state.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return;

  if (!ws.layout) {
    ws.layout = { type: "leaf", session: sessionName };
    return;
  }
  // Preserve manual/preset layout — append new pane to trailing edge
  ws.layout = appendLeafToTree(ws.layout, { type: "leaf", session: sessionName });
}

/** Build a balanced binary tree from a list of session names */
function buildBalancedTree(sessions) {
  if (sessions.length === 0) return null;
  if (sessions.length === 1) return { type: "leaf", session: sessions[0] };

  const mid = Math.ceil(sessions.length / 2);
  const left = sessions.slice(0, mid);
  const right = sessions.slice(mid);

  // Top-level: vertical split (rows). Within rows: horizontal split (columns).
  const direction = sessions.length <= 2 ? "h" : "v";
  return {
    type: "split",
    direction,
    ratio: mid / sessions.length,
    children: [buildBalancedTree(left), buildBalancedTree(right)],
  };
}

function countLeaves(node) {
  if (node.type === "leaf") return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

// ===== Pane drag-to-reorder =====

const paneDrag = { active: false, session: null, ghostEl: null, dropZoneEls: [], currentTarget: null };

function showDropZones(excludeSession) {
  clearDropZones();
  document.querySelectorAll(".pane[data-session]").forEach(paneEl => {
    const session = paneEl.dataset.session;
    if (session === excludeSession) return;
    const r = paneEl.getBoundingClientRect();
    [
      { side: "top",    x: r.left,               y: r.top,                w: r.width,        h: r.height * 0.25 },
      { side: "bottom", x: r.left,               y: r.top + r.height * 0.75, w: r.width,     h: r.height * 0.25 },
      { side: "left",   x: r.left,               y: r.top + r.height * 0.25, w: r.width * 0.25, h: r.height * 0.5 },
      { side: "right",  x: r.left + r.width * 0.75, y: r.top + r.height * 0.25, w: r.width * 0.25, h: r.height * 0.5 },
    ].forEach(({ side, x, y, w, h }) => {
      const el = document.createElement("div");
      el.className = "pane-drop-zone";
      el.dataset.session = session;
      el.dataset.side = side;
      el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
      document.body.appendChild(el);
      paneDrag.dropZoneEls.push(el);
    });
  });
}

function clearDropZones() {
  paneDrag.dropZoneEls.forEach(el => el.remove());
  paneDrag.dropZoneEls = [];
  paneDrag.currentTarget = null;
}

function updateDropZoneHighlight(mx, my) {
  let best = null;
  for (const el of paneDrag.dropZoneEls) {
    const r = el.getBoundingClientRect();
    if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) { best = el; break; }
  }
  paneDrag.dropZoneEls.forEach(el => el.classList.remove("active"));
  if (best) {
    best.classList.add("active");
    paneDrag.currentTarget = { session: best.dataset.session, side: best.dataset.side };
  } else {
    paneDrag.currentTarget = null;
  }
}

function commitPaneDrop() {
  const { session: dragSession, currentTarget, ghostEl } = paneDrag;
  ghostEl?.remove();
  clearDropZones();
  paneDrag.active = false; paneDrag.session = null; paneDrag.ghostEl = null;
  document.body.classList.remove("pane-dragging");
  if (!currentTarget || !dragSession || currentTarget.session === dragSession) return;
  const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
  if (!ws?.layout) return;
  const pruned = removeSessionFromLayout(ws.layout, dragSession);
  if (!pruned || !treeContains(pruned, currentTarget.session)) return;
  ws.layout = insertAdjacentToPane(pruned, currentTarget.session, dragSession, currentTarget.side);
  saveWorkspaces();
  renderActiveWorkspace();
}

function startPaneDrag(e, groupName) {
  const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
  if (!ws?.layout || getLeafList(ws.layout).length < 2) return;
  e.preventDefault();
  paneDrag.active = true; paneDrag.session = groupName;
  document.body.classList.add("pane-dragging");
  const ghost = document.createElement("div");
  ghost.className = "pane-drag-ghost";
  ghost.textContent = groupName;
  ghost.style.left = `${e.clientX + 12}px`; ghost.style.top = `${e.clientY + 8}px`;
  document.body.appendChild(ghost);
  paneDrag.ghostEl = ghost;
  showDropZones(groupName);
  const onMove = ev => {
    ghost.style.left = `${ev.clientX + 12}px`; ghost.style.top = `${ev.clientY + 8}px`;
    updateDropZoneHighlight(ev.clientX, ev.clientY);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("keydown", onKey);
    commitPaneDrop();
  };
  const onKey = ev => {
    if (ev.key !== "Escape") return;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("keydown", onKey);
    ghost.remove(); clearDropZones();
    paneDrag.active = false; paneDrag.session = null; paneDrag.ghostEl = null;
    document.body.classList.remove("pane-dragging");
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  document.addEventListener("keydown", onKey);
}

// ===== Layout presets =====

const LAYOUT_PRESETS = [
  { name: "Auto (balanced)",    min: 1, build: s => buildBalancedTree(s) },
  { name: "2 Columns",          min: 2, build: ([a,b]) => ({ type:"split", direction:"h", ratio:0.5, children:[{type:"leaf",session:a},{type:"leaf",session:b}] }) },
  { name: "3 Columns",          min: 3, build: ([a,b,c]) => ({ type:"split", direction:"h", ratio:0.333, children:[{type:"leaf",session:a},{type:"split",direction:"h",ratio:0.5,children:[{type:"leaf",session:b},{type:"leaf",session:c}]}] }) },
  { name: "2 Top + 1 Bottom",   min: 3, build: ([a,b,c]) => ({ type:"split", direction:"v", ratio:0.5, children:[{type:"split",direction:"h",ratio:0.5,children:[{type:"leaf",session:a},{type:"leaf",session:b}]},{type:"leaf",session:c}] }) },
  { name: "1 Top + 2 Bottom",   min: 3, build: ([a,b,c]) => ({ type:"split", direction:"v", ratio:0.5, children:[{type:"leaf",session:a},{type:"split",direction:"h",ratio:0.5,children:[{type:"leaf",session:b},{type:"leaf",session:c}]}] }) },
  { name: "Large Left + Stack", min: 3, build: ([a,b,c]) => ({ type:"split", direction:"h", ratio:0.6, children:[{type:"leaf",session:a},{type:"split",direction:"v",ratio:0.5,children:[{type:"leaf",session:b},{type:"leaf",session:c}]}] }) },
];

function applyLayoutPreset(ws, idx) {
  const preset = LAYOUT_PRESETS[idx];
  const sessions = getLeafList(ws.layout);
  if (!preset || sessions.length < preset.min) return;
  ws.layout = preset.build(sessions);
  saveWorkspaces(); renderActiveWorkspace();
}

function showLayoutPresetsMenu(e, ws) {
  e.stopPropagation();
  const menu = document.getElementById("pane-context-menu");
  menu.innerHTML = ""; menu.classList.remove("hidden");
  const rect = e.target.getBoundingClientRect();
  menu.style.left = `${rect.left}px`; menu.style.top = `${rect.bottom + 2}px`;
  const sessions = ws.layout ? getLeafList(ws.layout) : [];
  LAYOUT_PRESETS.forEach((p, i) => {
    const item = document.createElement("div");
    item.className = `ctx-item${sessions.length < p.min ? " ctx-disabled" : ""}`;
    item.textContent = p.name;
    if (sessions.length >= p.min) item.onclick = () => { applyLayoutPreset(ws, i); menu.classList.add("hidden"); };
    menu.appendChild(item);
  });
  const close = ev => {
    if (!menu.contains(ev.target)) { menu.classList.add("hidden"); document.removeEventListener("mousedown", close); }
  };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
}

function removeSessionFromLayout(node, sessionName) {
  if (!node) return null;
  if (node.type === "leaf") return node.session === sessionName ? null : node;
  const left = removeSessionFromLayout(node.children[0], sessionName);
  const right = removeSessionFromLayout(node.children[1], sessionName);
  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

function insertAdjacentToPane(node, targetSession, insertSession, side) {
  if (!node) return null;
  if (node.type === "leaf") {
    if (node.session !== targetSession) return node;
    const insertLeaf = { type: "leaf", session: insertSession };
    const direction = (side === "left" || side === "right") ? "h" : "v";
    const first  = (side === "left"  || side === "top")    ? insertLeaf : node;
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

function appendLeafToTree(node, newLeaf) {
  if (node.type === "leaf") {
    return { type: "split", direction: "h", ratio: 0.5, children: [node, newLeaf] };
  }
  return { ...node, children: [node.children[0], appendLeafToTree(node.children[1], newLeaf)] };
}

function renderActiveWorkspace() {
  const area = document.getElementById("workspace-area");
  area.innerHTML = "";

  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (!ws || !ws.layout) {
    const empty = document.createElement("div");
    empty.className = "dashboard active";
    empty.innerHTML = '<div class="dashboard-empty">Empty workspace. Use the folder browser or <kbd>Ctrl+P</kbd> to open a folder.</div>';
    area.appendChild(empty);
    return;
  }

  const container = document.createElement("div");
  container.className = "workspace active";
  area.appendChild(container);

  renderTileNode(ws.layout, container);
  requestAnimationFrame(() => fitAllTerminals(ws.layout));
}

function renderTileNode(node, parentEl) {
  if (node.type === "leaf") {
    parentEl.appendChild(createPane(node.session));
    return;
  }

  const container = document.createElement("div");
  container.className = "split-container";
  container.style.flexDirection = node.direction === "h" ? "row" : "column";
  parentEl.appendChild(container);

  const child1 = document.createElement("div");
  child1.className = "split-child";
  child1.style.flex = `${node.ratio} 0 0%`;
  container.appendChild(child1);

  const handle = document.createElement("div");
  handle.className = `drag-handle ${node.direction === "v" ? "vertical" : ""}`;
  setupDragHandle(handle, node, container);
  container.appendChild(handle);

  const child2 = document.createElement("div");
  child2.className = "split-child";
  child2.style.flex = `${1 - node.ratio} 0 0%`;
  container.appendChild(child2);

  renderTileNode(node.children[0], child1);
  renderTileNode(node.children[1], child2);
}

function setupDragHandle(handle, node, container) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("dragging");
    document.body.style.cursor = node.direction === "h" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    const startPos = node.direction === "h" ? e.clientX : e.clientY;
    const startRatio = node.ratio;
    const totalSize = node.direction === "h" ? container.offsetWidth : container.offsetHeight;

    const onMove = (e) => {
      const delta = (node.direction === "h" ? e.clientX : e.clientY) - startPos;
      node.ratio = Math.max(0.15, Math.min(0.85, startRatio + delta / totalSize));
      const children = container.querySelectorAll(":scope > .split-child");
      if (children[0]) children[0].style.flex = `${node.ratio} 0 0%`;
      if (children[1]) children[1].style.flex = `${1 - node.ratio} 0 0%`;
    };

    const onUp = () => {
      handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      if (ws?.layout) requestAnimationFrame(() => fitAllTerminals(ws.layout));
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function fitAllTerminals(node) {
  if (!node) return;
  if (node.type === "leaf") {
    const groupName = node.session;
    const pg = state.paneGroups.get(groupName);
    const activeSessionName = pg ? (pg.activeType === "pwsh" ? pg.pwsh : pg.claude) : groupName;
    const entry = state.terminals.get(activeSessionName || groupName);
    if (entry) { try { entry.fitAddon.fit(); } catch {} }
    return;
  }
  fitAllTerminals(node.children[0]);
  fitAllTerminals(node.children[1]);
}

// ===== Panes =====

function createPane(groupName) {
  // Resolve which session to show via pane group
  const pg = state.paneGroups.get(groupName);
  const activeType = pg?.activeType || "claude";
  const activeSessionName = activeType === "pwsh" ? (pg?.pwsh || groupName) : (pg?.claude || groupName);
  const info = state.sessions.get(activeSessionName);
  const hasBoth = pg?.claude && pg?.pwsh;

  const pane = document.createElement("div");
  pane.className = `pane ${groupName === state.focusedPane ? "focused" : ""} ${info?.status === "dead" ? "dead" : ""}`;
  pane.dataset.session = groupName;
  pane.addEventListener("mousedown", () => focusPane(groupName));

  // Top bar
  const topbar = document.createElement("div");
  topbar.className = "pane-topbar";

  // Toggle buttons (only when both session types exist)
  let toggleHtml = "";
  if (hasBoth) {
    const claudeActive = activeType === "claude" ? "active" : "";
    const pwshActive = activeType === "pwsh" ? "active" : "";
    toggleHtml = `<span class="pane-toggle">
      <button class="toggle-btn toggle-claude ${claudeActive}" title="Claude">C</button>
      <button class="toggle-btn toggle-pwsh ${pwshActive}" title="PowerShell">&gt;_</button>
    </span>`;
  }

  const identity = info?.emcomIdentity ? `<span class="pane-identity">${info.emcomIdentity}</span>` : "";
  const aiPreset = (activeType !== "pwsh" && info?.command) ? getAiPresetForCommand(info.command) : null;
  const presetBadge = aiPreset ? `<span class="pane-ai-preset" title="${aiPreset.name}">${aiPreset.icon} ${aiPreset.name}</span>` : "";
  topbar.innerHTML = `
    <span class="pane-name">${groupName}</span>
    ${toggleHtml}
    ${presetBadge}
    <span class="pane-action cmd-tag code" title="Open in VS Code">&lt;/&gt;</span>
    ${identity}
    <span class="pane-cwd" title="${info?.workingDir || ""}">${truncatePath(info?.workingDir || "")}</span>
    <span class="pane-close" title="Kill session">&times;</span>
  `;

  // Toggle button handlers
  if (hasBoth) {
    topbar.querySelector(".toggle-claude")?.addEventListener("click", (e) => {
      e.stopPropagation();
      switchPaneType(groupName, "claude");
    });
    topbar.querySelector(".toggle-pwsh")?.addEventListener("click", (e) => {
      e.stopPropagation();
      switchPaneType(groupName, "pwsh");
    });
  }

  topbar.querySelector(".pane-action.code").onclick = (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    fetch("/api/open-editor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: info?.workingDir || "" }),
    });
  };

  topbar.querySelector(".pane-close").onclick = (e) => {
    e.stopPropagation();
    killSession(activeSessionName);
  };

  topbar.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showPaneContextMenu(e, groupName);
  });

  const identityEl = topbar.querySelector(".pane-identity");
  if (identityEl) {
    identityEl.style.cursor = "pointer";
    identityEl.title = `Switch feed to ${info.emcomIdentity}`;
    identityEl.onclick = (e) => {
      e.stopPropagation();
      localStorage.setItem("pty-win-feed-identity", info.emcomIdentity);
      window.dispatchEvent(new CustomEvent("feed-identity-change", { detail: info.emcomIdentity }));
    };
  }

  topbar.addEventListener("mousedown", (e) => {
    if (e.target.closest("button, .pane-close, .pane-action, .pane-identity, .toggle-btn")) return;
    if (e.button !== 0) return;
    startPaneDrag(e, groupName);
  });

  pane.appendChild(topbar);

  // Terminal
  const termArea = document.createElement("div");
  termArea.className = "pane-terminal";
  pane.appendChild(termArea);

  // Status bar
  const statusbar = document.createElement("div");
  statusbar.className = "pane-statusbar";
  const status = info?.status || "starting";
  const unread = info?.unreadCount || 0;
  statusbar.innerHTML = `
    <span class="status-dot ${status}"></span>
    <span class="pane-status-label">${status}</span>
    <span class="pane-unread ${unread > 0 ? "show" : ""}">${unread}</span>
  `;
  pane.appendChild(statusbar);

  // Create or reattach xterm for the active session
  let entry = ensureTerminal(activeSessionName);

  // Fit terminal and explicitly notify server of new dimensions
  const fitAndSync = () => {
    try {
      entry.fitAddon.fit();
      const { cols, rows } = entry.term;
      state.ws?.send(JSON.stringify({ type: "resize", session: activeSessionName, payload: { cols, rows } }));
    } catch {}
  };

  // xterm.js can only open() once. Move the persistent wrapper on re-renders.
  requestAnimationFrame(() => {
    if (!entry.opened) {
      termArea.appendChild(entry.wrapperEl);
      entry.term.open(entry.wrapperEl);
      entry.opened = true;
    } else {
      termArea.appendChild(entry.wrapperEl);
    }
    fitAndSync();
    setTimeout(fitAndSync, 150);

    if (!entry.resizeObserver) {
      entry.resizeObserver = new ResizeObserver(fitAndSync);
      entry.resizeObserver.observe(termArea);
    } else {
      entry.resizeObserver.disconnect();
      entry.resizeObserver.observe(termArea);
    }
  });

  return pane;
}

function ensureTerminal(sessionName) {
  let entry = state.terminals.get(sessionName);
  if (entry) return entry;

  const term = new window.Terminal({
    theme: TERM_THEME,
    fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new window.WebLinksAddon.WebLinksAddon());

  term.onData((data) => {
    state.ws?.send(JSON.stringify({ type: "input", session: sessionName, payload: data }));
  });

  term.onResize(({ cols, rows }) => {
    state.ws?.send(JSON.stringify({ type: "resize", session: sessionName, payload: { cols, rows } }));
  });

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    if (e.ctrlKey && e.shiftKey) {
      switch (e.key) {
        case "D": case "d": switchToDashboard(); return false;
        case "H": case "h": return false;
        case "V": case "v": return false;
        case "W": case "w": closeFocusedPane(); return false;
        case "B": case "b": toggleSidebar(); return false;
      }
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (state.workspaces[idx]) switchToWorkspace(state.workspaces[idx].id);
        return false;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        resizeFocused(e.key); return false;
      }
    }
    if (e.ctrlKey && !e.shiftKey) {
      if (e.key === "p") { openQuickOpen(); return false; }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        navigatePanes(e.key); return false;
      }
      if (e.key === "v") {
        const AI_CMDS = ["claude", "agency cc", "agency cp", "copilot"];
        const sessionInfo = state.sessions.get(sessionName);
        if (sessionInfo && AI_CMDS.includes(sessionInfo.command)) {
          navigator.clipboard.readText().then((text) => {
            if (text) state.ws?.send(JSON.stringify({ type: "input", session: sessionName, payload: text }));
          }).catch(() => {});
          return false;
        }
      }
    }
    return true;
  });

  const wrapperEl = document.createElement("div");
  wrapperEl.style.position = "absolute";
  wrapperEl.style.inset = "0";

  entry = { term, fitAddon, opened: false, wrapperEl };
  state.terminals.set(sessionName, entry);
  return entry;
}

function switchPaneType(groupName, type) {
  const pg = state.paneGroups.get(groupName);
  if (!pg) return;
  pg.activeType = type;
  renderActiveWorkspace();
  focusPane(groupName);
}

function showAiTagContextMenu(e, folderPath, folderName) {
  const menu = document.getElementById("pane-context-menu");
  menu.innerHTML = "";
  menu.classList.remove("hidden");
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const resumeItem = document.createElement("div");
  resumeItem.className = "ctx-item";
  resumeItem.textContent = "\u25b6 Resume session";
  resumeItem.onclick = () => {
    menu.classList.add("hidden");
    openFolder(folderPath, folderName, "claude", false, ["--resume"]);
  };
  menu.appendChild(resumeItem);

  const sep = document.createElement("div");
  sep.className = "ctx-sep";
  menu.appendChild(sep);

  const pickerItem = document.createElement("div");
  pickerItem.className = "ctx-item";
  pickerItem.textContent = "\u2699 Choose AI preset\u2026";
  pickerItem.onclick = () => {
    menu.classList.add("hidden");
    showAiPicker(e, folderPath, folderName);
  };
  menu.appendChild(pickerItem);

  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.classList.add("hidden");
      document.removeEventListener("mousedown", close);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
}

function showAiPicker(e, folderPath, folderName) {
  const menu = document.getElementById("pane-context-menu");
  menu.innerHTML = "";
  menu.classList.remove("hidden");
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  for (let i = 0; i < state.aiPresets.length; i++) {
    const preset = state.aiPresets[i];
    const isDefault = i === state.aiDefaultIndex;
    const item = document.createElement("div");
    item.className = "ctx-item ai-picker-item";
    item.innerHTML = `<span class="default-star">${isDefault ? "\u2605" : ""}</span> ${preset.name} <span class="ai-icon">${preset.icon}</span>`;
    item.onclick = () => {
      menu.classList.add("hidden");
      openFolder(folderPath, folderName, preset.command);
    };
    item.oncontextmenu = (ev) => {
      ev.preventDefault();
      setAiDefault(i);
      showAiPicker(e, folderPath, folderName); // re-render to update star
    };
    item.title = isDefault ? `${preset.name} (default) — right-click to change` : `Launch ${preset.name} — right-click to set as default`;
    menu.appendChild(item);
  }

  const sep = document.createElement("div");
  sep.className = "ctx-sep";
  menu.appendChild(sep);

  const customItem = document.createElement("div");
  customItem.className = "ctx-item";
  customItem.textContent = "Custom command...";
  customItem.onclick = () => {
    menu.classList.add("hidden");
    const cmd = prompt("Command to run:", "claude");
    if (cmd) openFolder(folderPath, folderName, cmd);
  };
  menu.appendChild(customItem);

  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.classList.add("hidden");
      document.removeEventListener("mousedown", close);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
}

function showPaneContextMenu(e, groupName) {
  const menu = document.getElementById("pane-context-menu");
  menu.innerHTML = "";
  menu.classList.remove("hidden");
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const currentWs = findWorkspaceContaining(groupName);

  // Resume Claude session (only for dead AI sessions)
  const pg = state.paneGroups.get(groupName);
  const claudeSession = pg?.claude ? state.sessions.get(pg.claude) : null;
  const aiCommands = new Set(state.aiPresets.map((p) => p.command));
  const isDeadAi = claudeSession?.status === "dead" && aiCommands.has(claudeSession.command);
  const isNoAi = !claudeSession || claudeSession.status === "dead";
  if (isDeadAi || isNoAi) {
    const resumeItem = document.createElement("div");
    resumeItem.className = `ctx-item ${isDeadAi ? "" : "ctx-disabled"}`;
    resumeItem.textContent = "\u25b6 Resume Claude session";
    if (isDeadAi) {
      resumeItem.onclick = () => {
        menu.classList.add("hidden");
        openFolder(claudeSession.workingDir, groupName, "claude", false, ["--resume"]);
      };
    }
    menu.appendChild(resumeItem);

    const resumeSep = document.createElement("div");
    resumeSep.className = "ctx-sep";
    menu.appendChild(resumeSep);
  }

  // Move to existing workspaces
  const header = document.createElement("div");
  header.className = "ctx-header";
  header.textContent = "Move to";
  menu.appendChild(header);

  for (const ws of state.workspaces) {
    if (ws === currentWs) continue;
    const item = document.createElement("div");
    item.className = "ctx-item";
    item.textContent = ws.name;
    item.onclick = () => {
      movePaneToWorkspace(groupName, currentWs, ws);
      menu.classList.add("hidden");
    };
    menu.appendChild(item);
  }

  // Move to new workspace
  const sep = document.createElement("div");
  sep.className = "ctx-sep";
  menu.appendChild(sep);

  const newItem = document.createElement("div");
  newItem.className = "ctx-item";
  newItem.textContent = "+ New workspace";
  newItem.onclick = () => {
    const newWs = createWorkspace(groupName);
    movePaneToWorkspace(groupName, currentWs, newWs);
    switchToWorkspace(newWs.id);
    menu.classList.add("hidden");
  };
  menu.appendChild(newItem);

  // Close on click outside
  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.classList.add("hidden");
      document.removeEventListener("mousedown", close);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
}

function movePaneToWorkspace(groupName, fromWs, toWs) {
  if (fromWs) {
    fromWs.layout = removeSessionFromLayout(fromWs.layout, groupName);
    updateWorkspaceTabName(fromWs);
  }
  const existing = toWs.layout ? getLeafList(toWs.layout) : [];
  existing.push(groupName);
  toWs.layout = buildBalancedTree(existing);
  updateWorkspaceTabName(toWs);
  saveWorkspaces();
  renderTabs();
  renderActiveWorkspace();
}

function updatePaneStatus(sessionName) {
  const info = state.sessions.get(sessionName);
  if (!info) return;
  // Pane data-session is the group name
  const groupName = info.group || sessionName;
  const pg = state.paneGroups.get(groupName);
  const activeSessionName = pg ? (pg.activeType === "pwsh" ? pg.pwsh : pg.claude) : sessionName;
  // Only update status bar if this is the currently active session in the pane
  if (activeSessionName !== sessionName) return;
  document.querySelectorAll(`.pane[data-session="${groupName}"]`).forEach((pane) => {
    const dot = pane.querySelector(".status-dot");
    const label = pane.querySelector(".pane-status-label");
    const unread = pane.querySelector(".pane-unread");
    if (dot) dot.className = `status-dot ${info.status}`;
    if (label) label.textContent = info.status;
    if (unread) {
      unread.textContent = String(info.unreadCount);
      unread.classList.toggle("show", info.unreadCount > 0);
    }
    pane.classList.toggle("dead", info.status === "dead");
  });
}

function focusPane(groupName) {
  state.focusedPane = groupName;
  document.querySelectorAll(".pane").forEach((p) => {
    p.classList.toggle("focused", p.dataset.session === groupName);
  });
  // Update sessions panel highlight
  document.querySelectorAll(".session-row").forEach((r) => r.classList.remove("active"));
  document.querySelector(`.session-row[data-group="${groupName}"]`)?.classList.add("active");
  // Focus the active session's terminal
  const pg = state.paneGroups.get(groupName);
  const activeSessionName = pg ? (pg.activeType === "pwsh" ? pg.pwsh : pg.claude) : groupName;
  const entry = state.terminals.get(activeSessionName || groupName);
  if (entry) entry.term.focus();
}

function truncatePath(p) {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return p;
  return ".../" + parts.slice(-2).join("/");
}

// ===== Navigation =====

function getLeafList(node, list = []) {
  if (!node) return list;
  if (node.type === "leaf") { list.push(node.session); return list; }
  getLeafList(node.children[0], list);
  getLeafList(node.children[1], list);
  return list;
}

function navigatePanes(arrowKey) {
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (!ws?.layout) return;
  const leaves = getLeafList(ws.layout);
  if (!leaves.length) return;
  const idx = leaves.indexOf(state.focusedPane);
  const newIdx = (arrowKey === "ArrowRight" || arrowKey === "ArrowDown")
    ? (idx + 1) % leaves.length
    : (idx - 1 + leaves.length) % leaves.length;
  focusPane(leaves[newIdx]);
}

function resizeFocused(arrowKey) {
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (!ws?.layout || ws.layout.type !== "split") return;
  const splitNode = findParentSplit(ws.layout, state.focusedPane);
  if (!splitNode) return;
  const delta = 0.05;
  splitNode.ratio = (arrowKey === "ArrowRight" || arrowKey === "ArrowDown")
    ? Math.min(0.85, splitNode.ratio + delta)
    : Math.max(0.15, splitNode.ratio - delta);
  renderActiveWorkspace();
}

function findParentSplit(node, sessionName) {
  if (node.type === "leaf") return null;
  for (const child of node.children) {
    if (child.type === "leaf" && child.session === sessionName) return node;
    const found = findParentSplit(child, sessionName);
    if (found) return found;
  }
  return null;
}

function closeFocusedPane() {
  if (!state.focusedPane) return;
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (!ws) return;
  ws.layout = removeSessionFromLayout(ws.layout, state.focusedPane);
  state.focusedPane = null;
  const leaves = ws.layout ? getLeafList(ws.layout) : [];
  if (leaves.length > 0) state.focusedPane = leaves[0];
  renderActiveWorkspace();
}

async function killSession(sessionName) {
  try {
    await fetch(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: "DELETE" });
  } catch {}

  // Determine group — only remove tiling leaf if no sibling alive
  const groupName = sessionName.replace(/~pwsh$/, "");
  const siblingName = sessionName.endsWith("~pwsh") ? groupName : groupName + "~pwsh";
  const siblingAlive = state.sessions.has(siblingName) && state.sessions.get(siblingName).status !== "dead";

  if (!siblingAlive) {
    // No sibling — remove pane from all workspaces
    for (const ws of state.workspaces) {
      ws.layout = removeSessionFromLayout(ws.layout, groupName);
    }
  } else {
    // Sibling exists — switch to it
    const pg = state.paneGroups.get(groupName);
    if (pg) pg.activeType = sessionName.endsWith("~pwsh") ? "claude" : "pwsh";
  }

  // Destroy terminal
  const entry = state.terminals.get(sessionName);
  if (entry) {
    entry.resizeObserver?.disconnect();
    entry.term.dispose();
    entry.wrapperEl?.remove();
    state.terminals.delete(sessionName);
  }

  state.sessions.delete(sessionName);
  state.sessionMeta.delete(sessionName);
  saveSessionMeta();
  rebuildPaneGroups();
  if (state.focusedPane === groupName && !siblingAlive) state.focusedPane = null;

  refreshTreeRunningState();
  renderActiveWorkspace();
  renderTabs();
}

function showDirtyWarning(sessionName, workingDir) {
  const folderName = workingDir.split(/[/\\]/).filter(Boolean).pop();
  log(`[dirty] ${sessionName} exited with uncommitted changes in ${folderName}`);
  const toast = document.createElement("div");
  toast.className = "dirty-toast";
  toast.innerHTML = `<strong>⚠ ${folderName}</strong> has uncommitted changes (session ${sessionName} exited)`;
  toast.onclick = () => toast.remove();
  document.body.appendChild(toast);
  // Auto-dismiss after 30s
  setTimeout(() => toast.remove(), 30000);
}

function autoRemoveDeadSession(sessionName) {
  // Check it's still dead (not restarted)
  const s = state.sessions.get(sessionName);
  if (!s || s.status !== "dead") return;

  // Delete from server so the name can be reused
  fetch(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: "DELETE" }).catch(() => {});

  const groupName = sessionName.replace(/~pwsh$/, "");
  const siblingName = sessionName.endsWith("~pwsh") ? groupName : groupName + "~pwsh";
  const siblingAlive = state.sessions.has(siblingName) && state.sessions.get(siblingName).status !== "dead";

  if (!siblingAlive) {
    // No sibling — remove pane from all workspaces
    for (const ws of state.workspaces) {
      if (ws.layout && treeContains(ws.layout, groupName)) {
        const leaves = getLeafList(ws.layout).filter((n) => n !== groupName);
        ws.layout = buildBalancedTree(leaves);
        updateWorkspaceTabName(ws);
      }
    }
  } else {
    // Sibling alive — switch toggle
    const pg = state.paneGroups.get(groupName);
    if (pg) pg.activeType = sessionName.endsWith("~pwsh") ? "claude" : "pwsh";
  }

  // Destroy terminal
  const entry = state.terminals.get(sessionName);
  if (entry) {
    entry.resizeObserver?.disconnect();
    entry.term.dispose();
    entry.wrapperEl?.remove();
    state.terminals.delete(sessionName);
  }

  state.sessions.delete(sessionName);
  state.sessionMeta.delete(sessionName);
  saveSessionMeta();
  rebuildPaneGroups();

  if (state.focusedPane === groupName && !siblingAlive) {
    state.focusedPane = null;
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    const leaves = ws?.layout ? getLeafList(ws.layout) : [];
    if (leaves.length > 0) state.focusedPane = leaves[0];
  }

  refreshTreeRunningState();
  if (state.isDashboard) renderDashboard();
  else renderActiveWorkspace();
  renderTabs();
}

// ===== Dashboard =====

function renderDashboard() {
  const area = document.getElementById("workspace-area");
  area.innerHTML = "";

  const dash = document.createElement("div");
  dash.className = "dashboard active";
  area.appendChild(dash);

  if (state.sessions.size === 0) {
    dash.innerHTML = `
      <div class="dashboard-empty">
        No sessions running.<br><br>
        Use the folder browser or press <kbd>Ctrl+P</kbd> to open a folder.
      </div>
    `;
    return;
  }

  for (const [name, info] of state.sessions) {
    const card = document.createElement("div");
    card.className = "dashboard-card";
    const unread = info.unreadCount || 0;
    card.innerHTML = `
      <div class="dashboard-card-header">
        <span class="status-dot ${info.status}"></span>
        <span class="dashboard-card-name">${name}</span>
        <span class="dashboard-card-identity">${info.emcomIdentity ? info.emcomIdentity : info.command}</span>
        <span class="dashboard-card-badge ${unread > 0 ? "show" : ""}">${unread}</span>
      </div>
      <div class="dashboard-card-preview" id="preview-${CSS.escape(name)}">Loading...</div>
    `;
    card.onclick = () => focusExistingSession(name);
    dash.appendChild(card);
    loadSnapshot(name);
  }
}

async function loadSnapshot(sessionName) {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionName)}/snapshot?lines=8`);
    const data = await res.json();
    const el = document.getElementById(`preview-${CSS.escape(sessionName)}`);
    if (el) el.textContent = data.lines.join("\n") || "(no output yet)";
  } catch {}
}

// ===== Diagnostics =====

function renderDiag() {
  if (!state.isDiag) return;
  const area = document.getElementById("workspace-area");

  let container = area.querySelector(".diag-view");
  if (!container) {
    area.innerHTML = "";
    container = document.createElement("div");
    container.className = "diag-view";
    area.appendChild(container);
  }

  fetch("/api/stats")
    .then((r) => r.json())
    .then((stats) => {
      if (!state.isDiag) return;
      container.innerHTML = `
        <div class="diag-header">
          <span class="diag-title">DIAGNOSTICS</span>
          <span class="diag-subtitle">Rolling 5s averages · auto-refresh 5s</span>
        </div>
        <div class="diag-section-title">Session Stats</div>
        <table class="diag-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Status</th>
              <th colspan="3">Busy</th>
              <th colspan="3">Not Busy</th>
            </tr>
            <tr>
              <th></th><th></th>
              <th>cb/s</th><th>KB/s</th><th>avg b</th>
              <th>cb/s</th><th>KB/s</th><th>avg b</th>
            </tr>
          </thead>
          <tbody>
            ${stats.length === 0 ? '<tr><td colspan="8" class="diag-empty">No active sessions</td></tr>' :
              stats.map((s) => {
                const hot = s.busy.callbacksPerSec > 100;
                return `<tr class="${hot ? "diag-hot" : ""}">
                  <td class="diag-name">${s.name}</td>
                  <td class="diag-status ${s.status}">${s.status}</td>
                  <td class="${hot ? "diag-hot-val" : ""}">${s.busy.callbacksPerSec}</td>
                  <td>${(s.busy.bytesPerSec / 1024).toFixed(1)}</td>
                  <td>${s.busy.avgChunkBytes}</td>
                  <td>${s.notBusy.callbacksPerSec}</td>
                  <td>${(s.notBusy.bytesPerSec / 1024).toFixed(1)}</td>
                  <td>${s.notBusy.avgChunkBytes}</td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>`;
    })
    .catch(() => {
      if (!state.isDiag) return;
      container.innerHTML = `<div class="diag-header"><span class="diag-title">DIAGNOSTICS</span></div><div class="diag-empty">Failed to load stats</div>`;
    });
}

// ===== Modal =====

function openModal() {
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("m-path").value = "";
  document.getElementById("m-cmd").value = "claude";
  document.getElementById("m-path").focus();
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

document.getElementById("m-cancel").onclick = closeModal;
document.getElementById("m-create").onclick = () => {
  const path = document.getElementById("m-path").value.trim();
  const cmd = document.getElementById("m-cmd").value.trim() || undefined;
  if (!path) { alert("Path is required."); return; }
  closeModal();
  openFolder(path, null, cmd);
};
document.getElementById("modal-overlay").onclick = (e) => {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
};
document.getElementById("m-path").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("m-create").click();
  if (e.key === "Escape") closeModal();
});

// ===== Global keyboard shortcuts =====

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && !e.shiftKey && e.key === "p") {
    e.preventDefault();
    openQuickOpen();
  }
  if (e.ctrlKey && e.shiftKey) {
    switch (e.key) {
      case "D": case "d": e.preventDefault(); switchToDashboard(); break;
      case "B": case "b": e.preventDefault(); toggleSidebar(); break;
    }
    if (e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (state.workspaces[idx]) switchToWorkspace(state.workspaces[idx].id);
    }
  }
});

// ===== Window resize =====

window.addEventListener("resize", () => {
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (ws?.layout) requestAnimationFrame(() => fitAllTerminals(ws.layout));
});

// ===== Workspace button =====

// btn-new-workspace is now rendered inline in renderTabs()

// ===== Init =====

state.favorites = loadFavorites();
if (state.favorites.length === 0) state.favorites.push("C:\\");
state.pinnedFolders = loadPinnedFolders();
state.expandedPaths = loadExpandedPaths();
// Auto-expand favorites that haven't been explicitly collapsed
for (const f of state.favorites) {
  if (!state.expandedPaths.has(f) && state.expandedPaths.size === 0) {
    state.expandedPaths.add(f);
  }
}

// Restore sidebar width
const savedWidth = loadSidebarWidth();
document.getElementById("sidebar").style.width = `${savedWidth}px`;

// Restore workspaces (layouts referencing sessions — terminals reconnect via WS)
const savedWs = loadWorkspaces();
if (savedWs) {
  state.workspaces = savedWs.workspaces || [];
  state.activeWorkspaceId = savedWs.activeWorkspaceId || null;
  state.isDashboard = savedWs.isDashboard !== false;
  nextWorkspaceId = savedWs.nextId || 1;
}
state.sessionMeta = loadSessionMeta();

renderTabs();
if (state.isDashboard) renderDashboard();
else renderActiveWorkspace();
connect();

// ===== Emcom feed panel (neo-terminal theme) =====

(function initFeedPanel() {
  const FEED_POLL_MS = 10_000;
  const panel = document.getElementById("feed-panel");
  const strip = document.getElementById("feed-strip");
  const body = document.getElementById("feed-body");
  const collapseBtn = document.getElementById("feed-collapse-btn");
  const expandBtn = document.getElementById("feed-expand-btn");
  const titleEl = document.getElementById("feed-title");
  const unreadBadge = document.getElementById("feed-unread-badge");
  const stripBadge = document.getElementById("feed-strip-badge");
  const identityBadge = document.getElementById("feed-identity-badge");

  let feedIdentity = localStorage.getItem("pty-win-feed-identity") || "";

  // --- Expand/collapse all ---
  document.getElementById("feed-expand-all").onclick = () => {
    body.querySelectorAll(".feed-item").forEach(el => {
      const id = el.dataset.msgId;
      if (id) expandedItems.add(id);
      el.classList.add("expanded");
    });
  };
  document.getElementById("feed-collapse-all").onclick = () => {
    expandedItems.clear();
    body.querySelectorAll(".feed-item").forEach(el => el.classList.remove("expanded"));
  };

  // --- Deterministic sender colors ---
  const SENDER_PALETTE = [
    "#61afef", "#c678dd", "#e06c75", "#98c379", "#d19a66", "#56b6c2",
    "#e5c07b", "#ff6ac1", "#7ee787", "#a2d2fb", "#ffa657", "#bc8cff",
  ];
  const senderColorCache = new Map();
  function getSenderColor(name) {
    if (senderColorCache.has(name)) return senderColorCache.get(name);
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    const color = SENDER_PALETTE[Math.abs(hash) % SENDER_PALETTE.length];
    senderColorCache.set(name, color);
    return color;
  }

  // --- Restore saved width ---
  const savedFeedWidth = parseInt(localStorage.getItem("pty-win-feed-width"), 10);
  if (savedFeedWidth && savedFeedWidth >= 150) panel.style.width = `${savedFeedWidth}px`;

  // --- Resize handle ---
  const feedHandle = document.getElementById("feed-resize-handle");
  feedHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // Pause ResizeObservers during drag to prevent fit() on every frame
    for (const entry of state.terminals.values()) entry.resizeObserver?.disconnect();
    let rafPending = false;
    const onMove = (ev) => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const newWidth = Math.max(150, window.innerWidth - ev.clientX);
        panel.style.width = `${newWidth}px`;
      });
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      localStorage.setItem("pty-win-feed-width", parseInt(panel.style.width, 10));
      // Reconnect ResizeObservers + fit once
      const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
      for (const [name, entry] of state.terminals) {
        const el = document.querySelector(`.pane[data-session="${name}"] .pane-terminal`);
        if (el && entry.resizeObserver) entry.resizeObserver.observe(el);
      }
      if (ws?.layout) requestAnimationFrame(() => requestAnimationFrame(() => fitAllTerminals(ws.layout)));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // --- Collapse / expand ---
  const isOpen = localStorage.getItem("pty-win-feed-open") !== "false";
  if (!isOpen) { panel.classList.add("hidden"); strip.classList.remove("hidden"); }
  else { strip.classList.add("hidden"); }

  collapseBtn.onclick = () => {
    panel.classList.add("hidden");
    strip.classList.remove("hidden");
    localStorage.setItem("pty-win-feed-open", "false");
  };
  expandBtn.onclick = () => {
    panel.classList.remove("hidden");
    strip.classList.add("hidden");
    localStorage.setItem("pty-win-feed-open", "true");
    if (feedIdentity) renderFeed(); else showIdentityPicker();
  };

  // --- Header ---
  function updateTitle() {
    titleEl.textContent = "EMCOM FEED";
    identityBadge.textContent = feedIdentity || "";
    identityBadge.onclick = feedIdentity ? (e) => {
      e.stopPropagation();
      if (pickerOpen) { pickerOpen = false; lastFeedJson = ""; renderFeed(); }
      else showIdentityPicker();
    } : null;
  }

  function updateUnreadBadge(count) {
    if (count > 0) {
      unreadBadge.textContent = count; unreadBadge.classList.remove("hidden");
      stripBadge.textContent = count; stripBadge.classList.remove("hidden");
    } else {
      unreadBadge.classList.add("hidden");
      stripBadge.classList.add("hidden");
    }
  }

  // --- Identity picker ---
  let pickerOpen = false;
  function showIdentityPicker() {
    pickerOpen = true;
    body.innerHTML = '<div class="feed-empty">// LOADING IDENTITIES...</div>';
    fetch(`/api/emcom/who?_=${Date.now()}`)
      .then(r => r.json())
      .then(identities => {
        body.innerHTML = "";
        if (!identities || identities.length === 0) {
          body.innerHTML = '<div class="feed-empty">// NO REGISTERED IDENTITIES<br>&gt; awaiting signal...</div>';
          return;
        }
        const picker = document.createElement("div");
        picker.className = "feed-identity-picker";
        picker.innerHTML = '<div class="feed-picker-title">Select identity</div>';
        for (const id of identities) {
          const btn = document.createElement("div");
          btn.className = `feed-identity-option${id.name === feedIdentity ? " active" : ""}`;
          const dot = document.createElement("span");
          dot.className = `feed-id-status ${id.active ? "active" : "inactive"}`;
          btn.appendChild(dot);
          const nameSpan = document.createElement("span");
          nameSpan.className = "feed-id-name";
          nameSpan.textContent = id.name;
          btn.appendChild(nameSpan);
          if (id.description) {
            const desc = document.createElement("span");
            desc.className = "feed-id-desc";
            desc.textContent = id.description;
            btn.appendChild(desc);
          }
          btn.onclick = () => {
            pickerOpen = false;
            feedIdentity = id.name;
            localStorage.setItem("pty-win-feed-identity", feedIdentity);
            updateTitle();
            renderFeed();
          };
          picker.appendChild(btn);
        }
        body.appendChild(picker);
      })
      .catch(() => { body.innerHTML = '<div class="feed-empty">// CONNECTION FAILED<br>&gt; server unavailable</div>'; });
  }

  // --- State ---
  const expandedItems = new Set();
  let previousIds = new Set();
  let lastFeedJson = "";
  let sortNewest = true;
  let threadsCollapsed = false;
  let filterSender = "";
  let filterText = "";

  // --- Toolbar controls ---
  const searchInput = document.getElementById("feed-search");
  const senderSelect = document.getElementById("feed-sender-filter");
  const sortBtn = document.getElementById("feed-sort-btn");
  const threadsBtn = document.getElementById("feed-threads-btn");

  searchInput.oninput = () => { filterText = searchInput.value.toLowerCase(); lastFeedJson = ""; renderFeed(); };
  senderSelect.onchange = () => { filterSender = senderSelect.value; lastFeedJson = ""; renderFeed(); };
  sortBtn.onclick = () => {
    sortNewest = !sortNewest;
    sortBtn.innerHTML = sortNewest ? "&#x25BC;" : "&#x25B2;";
    sortBtn.title = sortNewest ? "Newest first" : "Oldest first";
    lastFeedJson = "";
    renderFeed();
  };
  threadsBtn.onclick = () => {
    threadsCollapsed = !threadsCollapsed;
    threadsBtn.classList.toggle("active", threadsCollapsed);
    threadsBtn.title = threadsCollapsed ? "Threads collapsed" : "Threads expanded";
    lastFeedJson = "";
    renderFeed();
  };

  function fmtTime(iso) {
    const d = new Date(iso);
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hr = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${mo}/${day} ${hr}:${min}`;
  }

  function escHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // --- Render feed ---
  function renderFeed() {
    if (panel.classList.contains("hidden")) return;
    if (pickerOpen) return;
    if (!feedIdentity) { showIdentityPicker(); return; }
    fetch(`/api/emcom-feed?identity=${encodeURIComponent(feedIdentity)}`)
      .then(r => r.text())
      .then(text => {
        if (text === lastFeedJson) return; // skip re-render if unchanged
        lastFeedJson = text;
        let emails;
        try { emails = JSON.parse(text); } catch { emails = { error: "parse error" }; }
        if (!Array.isArray(emails)) {
          body.innerHTML = `<div class="feed-empty">// ${(emails.error || "UNAVAILABLE").toUpperCase()}</div>`;
          updateUnreadBadge(0);
          return;
        }
        if (emails.length === 0) {
          body.innerHTML = '<div class="feed-empty">// NO MESSAGES<br><br>&gt; awaiting signal...</div>';
          updateUnreadBadge(0);
          return;
        }

        // Sort
        emails.sort((a, b) => sortNewest
          ? new Date(b.created_at) - new Date(a.created_at)
          : new Date(a.created_at) - new Date(b.created_at));

        // Populate sender dropdown (preserve current selection)
        const senders = [...new Set(emails.map(e => e.sender))].sort();
        const prevSender = senderSelect.value;
        senderSelect.innerHTML = '<option value="">all</option>';
        for (const s of senders) {
          const opt = document.createElement("option");
          opt.value = s; opt.textContent = s;
          if (s === prevSender) opt.selected = true;
          senderSelect.appendChild(opt);
        }

        // Filter
        let filtered = emails;
        if (filterSender) filtered = filtered.filter(e => e.sender === filterSender);
        if (filterText) filtered = filtered.filter(e =>
          (e.subject || "").toLowerCase().includes(filterText) ||
          (e.body || "").toLowerCase().includes(filterText) ||
          (e.sender || "").toLowerCase().includes(filterText));

        const threadMap = new Map();
        for (const e of filtered) {
          if (!threadMap.has(e.thread_id)) threadMap.set(e.thread_id, []);
          threadMap.get(e.thread_id).push(e);
        }
        const seen = new Set();
        const items = [];
        for (const e of filtered) {
          if (!seen.has(e.thread_id)) {
            seen.add(e.thread_id);
            const thread = threadMap.get(e.thread_id);
            items.push({ root: thread[0], replies: thread.slice(1) });
          }
        }

        let unreadCount = 0;
        for (const e of emails) { if (e.tags?.includes("unread")) unreadCount++; }
        updateUnreadBadge(unreadCount);

        const currentIds = new Set(emails.map(e => e.id));
        const scrollTop = body.scrollTop;

        body.classList.add("feed-no-transition");
        body.innerHTML = "";
        for (const { root, replies } of items) {
          const threadDiv = document.createElement("div");
          threadDiv.className = "feed-thread";

          const isUnread = root.tags?.includes("unread");
          const isExpanded = expandedItems.has(root.id);
          const isNew = !previousIds.has(root.id) && previousIds.size > 0;
          const senderColor = getSenderColor(root.sender);
          const div = document.createElement("div");
          div.className = `feed-item${isUnread ? " unread" : ""}${isExpanded ? " expanded" : ""}${isNew ? " feed-new" : ""}`;
          div.dataset.msgId = root.id;
          div.style.setProperty("--sender-color", senderColor);
          div.innerHTML = `
            <div class="feed-meta">
              <span class="feed-sender" style="color:${senderColor}">${isUnread ? '<span class="feed-unread-dot"></span>' : ""}${escHtml(root.sender)}</span>
              <span class="feed-time">${fmtTime(root.created_at)}</span>
            </div>
            <div class="feed-subject">${escHtml(root.subject)}${replies.length > 0 ? `<span class="feed-thread-count">[${replies.length + 1}]</span>` : ""}</div>
            <div class="feed-preview">${escHtml((root.body || "").slice(0, 100))}</div>
            <div class="feed-body-text">${escHtml(root.body || "")}</div>`;
          div.onclick = (e) => {
            if (e.target.closest(".feed-body-text")) return;
            if (expandedItems.has(root.id)) expandedItems.delete(root.id);
            else expandedItems.add(root.id);
            div.classList.toggle("expanded");
          };
          threadDiv.appendChild(div);

          for (const reply of (threadsCollapsed ? [] : replies)) {
            const rUnread = reply.tags?.includes("unread");
            const rExpanded = expandedItems.has(reply.id);
            const rNew = !previousIds.has(reply.id) && previousIds.size > 0;
            const rColor = getSenderColor(reply.sender);
            const rdiv = document.createElement("div");
            rdiv.className = `feed-item feed-reply${rUnread ? " unread" : ""}${rExpanded ? " expanded" : ""}${rNew ? " feed-new" : ""}`;
            rdiv.dataset.msgId = reply.id;
            rdiv.style.setProperty("--sender-color", rColor);
            rdiv.innerHTML = `
              <div class="feed-meta">
                <span class="feed-sender" style="color:${rColor}">${rUnread ? '<span class="feed-unread-dot"></span>' : ""}${escHtml(reply.sender)}</span>
                <span class="feed-time">${fmtTime(reply.created_at)}</span>
              </div>
              <div class="feed-preview">${escHtml((reply.body || "").slice(0, 100))}</div>
              <div class="feed-body-text">${escHtml(reply.body || "")}</div>`;
            rdiv.onclick = (e) => {
              if (e.target.closest(".feed-body-text")) return;
              if (expandedItems.has(reply.id)) expandedItems.delete(reply.id);
              else expandedItems.add(reply.id);
              rdiv.classList.toggle("expanded");
            };
            threadDiv.appendChild(rdiv);
          }

          body.appendChild(threadDiv);
        }

        body.scrollTop = scrollTop;
        requestAnimationFrame(() => body.classList.remove("feed-no-transition"));
        previousIds = currentIds;
      })
      .catch(() => {
        body.innerHTML = '<div class="feed-empty">// CONNECTION LOST<br>&gt; server unavailable</div>';
        updateUnreadBadge(0);
      });
  }

  // --- Initialize ---
  updateTitle();
  if (feedIdentity) { renderFeed(); }
  else if (isOpen) showIdentityPicker();
  setInterval(() => { if (feedIdentity) renderFeed(); }, FEED_POLL_MS);

  // Listen for identity changes from pane topbar clicks
  window.addEventListener("feed-identity-change", (e) => {
    feedIdentity = e.detail;
    pickerOpen = false;
    lastFeedJson = "";
    updateTitle();
    renderFeed();
  });
})();
