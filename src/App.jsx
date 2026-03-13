import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA1nVimSTwFWvAPbMQ3ZT7RIrrHZyvUQIo",
  authDomain: "notebook-7276b.firebaseapp.com",
  projectId: "notebook-7276b",
  storageBucket: "notebook-7276b.firebasestorage.app",
  messagingSenderId: "185736803134",
  appId: "1:185736803134:web:c3e611d4d471d7464db26f",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const FONT = "'Courier New', monospace";
const defaultTree = { type: "folder", children: {} };

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function save(uid, tree) {
  await setDoc(doc(db, "notebooks", uid), { tree: JSON.stringify(tree) });
}
async function load(uid) {
  const snap = await getDoc(doc(db, "notebooks", uid));
  return snap.exists() ? JSON.parse(snap.data().tree) : defaultTree;
}
async function createShare(subtree, name, mode = "read") {
  const id = Math.random().toString(36).slice(2, 12);
  await setDoc(doc(db, "shared", id), { tree: JSON.stringify(subtree), name, mode });
  return id;
}
async function loadShare(id) {
  const snap = await getDoc(doc(db, "shared", id));
  return snap.exists()
    ? { tree: JSON.parse(snap.data().tree), name: snap.data().name, mode: snap.data().mode || "read" }
    : null;
}
async function saveSharedTree(id, subtree) {
  await setDoc(doc(db, "shared", id), { tree: JSON.stringify(subtree) }, { merge: true });
}
function getNode(tree, path) {
  let node = tree;
  for (const p of path) node = node.children[p];
  return node;
}

const s = {
  app: { fontFamily: FONT, maxWidth: 680, margin: "0 auto", padding: "40px 20px", minHeight: "100vh", background: "#fafaf8" },
  crumb: { background: "none", border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 14, color: "#888", padding: 0, textDecoration: "underline" },
  current: { fontSize: 14, color: "#222" },
  row: { display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee", gap: 8 },
  icon: { width: 18, color: "#aaa", fontSize: 13, flexShrink: 0, textAlign: "center" },
  name: { flex: 1, background: "none", border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 14, textAlign: "left", padding: 0, color: "#222" },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 12, fontFamily: FONT, padding: "0 3px" },
  toolbar: { display: "flex", gap: 12, marginTop: 24 },
  btn: { background: "none", border: "1px solid #ccc", borderRadius: 2, cursor: "pointer", fontFamily: FONT, fontSize: 13, padding: "4px 12px", color: "#555" },
  inlineInput: { fontFamily: FONT, fontSize: 14, border: "none", borderBottom: "1px solid #999", background: "transparent", outline: "none", width: 200, padding: "2px 0" },
  editor: { position: "fixed", inset: 0, background: "#fafaf8", display: "flex", flexDirection: "column", padding: "32px 40px", zIndex: 10 },
  textarea: { flex: 1, fontFamily: FONT, fontSize: 14, border: "none", outline: "none", background: "transparent", resize: "none", lineHeight: 1.7, color: "#333" },
  back: { marginBottom: 24, background: "none", border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13, color: "#888", padding: 0, textDecoration: "underline" },
  signIn: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: FONT, background: "#fafaf8", gap: 16 },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modalBox: { background: "#fafaf8", padding: "32px", fontFamily: FONT, display: "flex", flexDirection: "column", gap: 16, minWidth: 280, border: "1px solid #eee" },
  modalInput: { fontFamily: FONT, fontSize: 14, border: "none", borderBottom: "1px solid #999", background: "transparent", outline: "none", padding: "4px 0", width: "100%" },
};

// Password prompt modal
function PasswordModal({ title, onConfirm, onCancel, error }) {
  const [value, setValue] = useState("");
  const inputRef = useRef();
  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  return (
    <div style={s.modal}>
      <div style={s.modalBox}>
        <div style={{ fontSize: 14, color: "#222" }}>🔒 {title}</div>
        <input
          ref={inputRef}
          style={s.modalInput}
          type="password"
          placeholder="enter password…"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") onConfirm(value); if (e.key === "Escape") onCancel(); }}
        />
        {error && <div style={{ fontSize: 12, color: "#c00" }}>incorrect password</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.btn} onClick={() => onConfirm(value)}>unlock</button>
          <button style={{ ...s.btn, border: "none" }} onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  );
}

function ShareModal({ name, onShare, onClose }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(null); // "read" | "edit"
  const [copied, setCopied] = useState(false);

  async function handleShare(mode) {
    setLoading(mode);
    const shareUrl = await onShare(mode);
    setUrl(shareUrl);
    setLoading(null);
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    setCopied(true);
  }

  return (
    <div style={s.modal}>
      <div style={s.modalBox}>
        <div style={{ fontSize: 14, color: "#222", marginBottom: 4 }}>share "{name}"</div>
        {!url ? (
          <>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>choose access level:</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{ ...s.btn, flex: 1 }}
                disabled={!!loading}
                onClick={() => handleShare("read")}
              >
                {loading === "read" ? "…" : "👁 read only"}
              </button>
              <button
                style={{ ...s.btn, flex: 1 }}
                disabled={!!loading}
                onClick={() => handleShare("edit")}
              >
                {loading === "edit" ? "…" : "✏ read + edit"}
              </button>
            </div>
            <button style={{ ...s.btn, border: "none", alignSelf: "flex-start" }} onClick={onClose}>cancel</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "#aaa" }}>link ready — share it with anyone:</div>
            <div style={{
              fontFamily: FONT, fontSize: 11, color: "#555", background: "#f3f3f0",
              padding: "8px 10px", borderRadius: 2, wordBreak: "break-all", userSelect: "all"
            }}>{url}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button style={s.btn} onClick={async () => {
                await navigator.clipboard.writeText(url).catch(() => {});
                setCopied(true);
              }}>
                {copied ? "✓ copied" : "copy link"}
              </button>
              <button style={{ ...s.btn, border: "none" }} onClick={onClose}>done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SharedView({ id }) {
  const [data, setData] = useState(null);
  const [path, setPath] = useState([]);
  const [openPage, setOpenPage] = useState(null);

  useEffect(() => { loadShare(id).then(d => setData(d || false)); }, [id]);

  if (data === null) return <div style={{ ...s.signIn, color: "#aaa" }}>loading…</div>;
  if (data === false) return <div style={{ ...s.signIn, color: "#aaa" }}>link not found</div>;

  const root = data.tree;
  const canEdit = data.mode === "edit";
  const badge = canEdit
    ? <span style={{ fontSize: 12, color: "#888" }}>shared · read + edit</span>
    : <span style={{ fontSize: 12, color: "#bbb" }}>shared · read only</span>;

  async function savePageContent(content) {
    // Update the local tree and persist to shared doc
    const newTree = JSON.parse(JSON.stringify(root));
    const node = openPage.path.reduce((n, p) => n.children[p], newTree);
    node.content = content;
    setData({ ...data, tree: newTree });
    setOpenPage({ ...openPage, content });
    await saveSharedTree(id, newTree);
  }

  if (root.type === "page" || openPage) {
    const content = openPage ? openPage.content : root.content;
    const name = openPage ? openPage.name : data.name;
    return (
      <div style={s.editor}>
        {openPage && <button style={s.back} onClick={() => setOpenPage(null)}>← back</button>}
        <div style={{ fontSize: 18, marginBottom: 12, color: "#222" }}>{name}</div>
        {canEdit
          ? <textarea
              style={s.textarea}
              defaultValue={content}
              placeholder="Start writing…"
              onBlur={e => savePageContent(e.target.value)}
              autoFocus
            />
          : <div style={{ ...s.textarea, whiteSpace: "pre-wrap", overflow: "auto" }}>
              {content || <span style={{ color: "#bbb" }}>empty page</span>}
            </div>
        }
        <div style={{ marginTop: 16 }}>{badge}</div>
      </div>
    );
  }

  const folder = getNode(root, path);
  const items = Object.entries(folder.children).sort(([,a],[,b]) =>
    a.type === b.type ? 0 : a.type === "folder" ? -1 : 1
  );

  return (
    <div style={s.app}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32, flexWrap: "wrap" }}>
        <button style={s.crumb} onClick={() => setPath([])}>{data.name}</button>
        {path.map((p, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#ccc", fontSize: 14 }}>/</span>
            {i < path.length - 1
              ? <button style={s.crumb} onClick={() => setPath(path.slice(0, i + 1))}>{p}</button>
              : <span style={s.current}>{p}</span>}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        {badge}
      </div>
      {items.map(([name, node]) => (
        <div key={name} style={s.row}>
          <span style={s.icon}>{node.type === "folder" ? "▶" : "·"}</span>
          <button style={s.name} onClick={() =>
            node.type === "folder"
              ? setPath([...path, name])
              : setOpenPage({ name, content: node.content, path: [...path, name] })
          }>{name}</button>
        </div>
      ))}
      {items.length === 0 && <div style={{ color: "#bbb", fontSize: 13 }}>empty</div>}
    </div>
  );
}

export default function App() {
  const shareMatch = window.location.hash.match(/^#share\/(.+)/);
  if (shareMatch) return <SharedView id={shareMatch[1]} />;

  const [user, setUser] = useState(undefined);
  const [tree, setTree] = useState(null);
  const [path, setPath] = useState([]);
  const [openPage, setOpenPage] = useState(null);
  const [creating, setCreating] = useState(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [renameTo, setRenameTo] = useState("");
  const [copied, setCopied] = useState(null);
  const [shareModal, setShareModal] = useState(null); // { name, node }
  const inputRef = useRef();
  const renameRef = useRef();
  const lockPasswordRef = useRef();

  // Lock state during creation
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockPassword, setLockPassword] = useState("");

  // Tracks which nodes are unlocked this session: key = path+name joined
  const [unlockedKeys, setUnlockedKeys] = useState(new Set());

  // Password prompt state
  const [promptFor, setPromptFor] = useState(null); // { name, node, action: "open"|"enter" }
  const [promptError, setPromptError] = useState(false);

  useEffect(() => { if (creating && inputRef.current) inputRef.current.focus(); }, [creating]);
  useEffect(() => { if (renaming && renameRef.current) renameRef.current.focus(); }, [renaming]);
  useEffect(() => { if (lockEnabled && lockPasswordRef.current) lockPasswordRef.current.focus(); }, [lockEnabled]);

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    if (u) setTree(await load(u.uid));
    else setTree(null);
  }), []);

  function update(newTree) { setTree(newTree); save(user.uid, newTree); }

  function nodeKey(nodePath, name) {
    return [...nodePath, name].join("/");
  }

  function isUnlocked(name) {
    return unlockedKeys.has(nodeKey(path, name));
  }

  function unlock(name) {
    setUnlockedKeys(prev => new Set([...prev, nodeKey(path, name)]));
  }

  async function handlePromptConfirm(password) {
  if (!promptFor) return;
  const { name, node, action } = promptFor;
  const hash = await hashPassword(password);
  if (hash !== node.passwordHash) {
    setPromptError(true);
    return;
  }
  // Don't call unlock(name) — just act directly
  setPromptFor(null);
  setPromptError(false);
  if (action === "open") {
    if (node.type === "folder") {
      setPath([...path, name]);
    } else {
      setOpenPage({ name, content: node.content });
    }
  }
}

  function handleItemClick(name, node) {
    if (node.locked && !isUnlocked(name)) {
      setPromptFor({ name, node, action: "open" });
      setPromptError(false);
      return;
    }
    if (node.type === "folder") setPath([...path, name]);
    else setOpenPage({ name, content: node.content });
  }

  async function create() {
    const name = newName.trim();
    if (!name || folder.children[name]) return;

    let passwordHash = null;
    if (lockEnabled) {
      if (!lockPassword.trim()) return;
      passwordHash = await hashPassword(lockPassword);
    }

    const newTree = JSON.parse(JSON.stringify(tree));
    const newNode = creating === "folder"
      ? { type: "folder", children: {}, ...(passwordHash && { locked: true, passwordHash }) }
      : { type: "page", content: "", ...(passwordHash && { locked: true, passwordHash }) };

    getNode(newTree, path).children[name] = newNode;
    update(newTree);
    setCreating(null);
    setNewName("");
    setLockEnabled(false);
    setLockPassword("");
  }

  function cancelCreate() {
    setCreating(null);
    setNewName("");
    setLockEnabled(false);
    setLockPassword("");
  }

  function deleteItem(name) {
    if (!confirm(`Delete "${name}"?`)) return;
    const newTree = JSON.parse(JSON.stringify(tree));
    delete getNode(newTree, path).children[name];
    update(newTree);
    if (openPage?.name === name) setOpenPage(null);
  }

  function rename(oldName) {
    const n = renameTo.trim();
    if (!n || n === oldName || folder.children[n]) { setRenaming(null); return; }
    const newTree = JSON.parse(JSON.stringify(tree));
    const node = getNode(newTree, path);
    node.children[n] = node.children[oldName];
    delete node.children[oldName];
    update(newTree);
    setRenaming(null);
    if (openPage?.name === oldName) setOpenPage({ ...openPage, name: n });
  }

  function openShare(name, node) {
    setShareModal({ name, node });
  }

  async function doShare(mode) {
    const { name, node } = shareModal;
    const id = await createShare(node, name, mode);
    return `${window.location.origin}/#share/${id}`;
  }

  function savePage(content) {
    const newTree = JSON.parse(JSON.stringify(tree));
    getNode(newTree, [...path, openPage.name]).content = content;
    update(newTree);
    setOpenPage({ ...openPage, content });
  }

  if (user === undefined) return <div style={{ ...s.signIn, color: "#aaa" }}>loading…</div>;
  if (!user) return (
    <div style={s.signIn}>
      <div style={{ fontSize: 18, color: "#222" }}>notebook</div>
      <button style={s.btn} onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>sign in with google</button>
    </div>
  );
  if (!tree) return <div style={{ ...s.signIn, color: "#aaa" }}>loading…</div>;

  const folder = getNode(tree, path);
  const items = Object.entries(folder.children).sort(([,a],[,b]) =>
    a.type === b.type ? 0 : a.type === "folder" ? -1 : 1
  );

  if (openPage) return (
    <div style={s.editor}>
      <button style={s.back} onClick={() => setOpenPage(null)}>← back</button>
      <div style={{ fontSize: 18, marginBottom: 16, color: "#222" }}>{openPage.name}</div>
      <textarea style={s.textarea} defaultValue={openPage.content} placeholder="Start writing…" onBlur={e => savePage(e.target.value)} autoFocus />
    </div>
  );

  return (
    <div style={s.app}>
      {shareModal && (
        <ShareModal
          name={shareModal.name}
          onShare={doShare}
          onClose={() => setShareModal(null)}
        />
      )}

      {/* Password prompt modal */}
      {promptFor && (
        <PasswordModal
          title={`"${promptFor.name}" is locked`}
          onConfirm={handlePromptConfirm}
          onCancel={() => { setPromptFor(null); setPromptError(false); }}
          error={promptError}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32, flexWrap: "wrap" }}>
        <button style={s.crumb} onClick={() => setPath([])}>notebook</button>
        {path.map((p, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#ccc", fontSize: 14 }}>/</span>
            {i < path.length - 1
              ? <button style={s.crumb} onClick={() => setPath(path.slice(0, i + 1))}>{p}</button>
              : <span style={s.current}>{p}</span>}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button style={s.crumb} onClick={() => signOut(auth)}>{user.displayName} · sign out</button>
      </div>

      {items.length === 0 && !creating && (
        <div style={{ color: "#bbb", fontSize: 13, marginBottom: 24 }}>empty — add something below</div>
      )}

      {items.map(([name, node]) => (
        <div key={name} style={s.row}>
          <span style={s.icon}>{node.type === "folder" ? "▶" : "·"}</span>
          {renaming === name ? (
            <input ref={renameRef} style={s.inlineInput} value={renameTo}
              onChange={e => setRenameTo(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") rename(name); if (e.key === "Escape") setRenaming(null); }}
              onBlur={() => rename(name)} />
          ) : (
            <button style={s.name} onClick={() => handleItemClick(name, node)}>
              {node.locked && !isUnlocked(name) ? "🔒 " : ""}{name}
            </button>
          )}
          <button style={s.iconBtn} title="rename" onClick={() => { setRenaming(name); setRenameTo(name); }}>✎</button>
          <button style={s.iconBtn} title="share" onClick={() => openShare(name, node)}>⤴</button>
          <button style={s.iconBtn} onClick={() => deleteItem(name)}>✕</button>
        </div>
      ))}

      {creating && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0", borderBottom: "1px solid #eee" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={s.icon}>{creating === "folder" ? "▶" : "·"}</span>
            <input ref={inputRef} style={s.inlineInput} value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !lockEnabled) create(); if (e.key === "Escape") cancelCreate(); }}
              placeholder={`${creating} name…`} />
            {/* Lock toggle button */}
            <button
              style={{ ...s.iconBtn, color: lockEnabled ? "#555" : "#ccc", fontSize: 14 }}
              title={lockEnabled ? "remove lock" : "add lock"}
              onClick={() => { setLockEnabled(v => !v); setLockPassword(""); }}
            >🔒</button>
            <button style={s.btn} onClick={create}>ok</button>
            <button style={{ ...s.btn, border: "none" }} onClick={cancelCreate}>cancel</button>
          </div>
          {lockEnabled && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 26 }}>
              <span style={{ fontSize: 12, color: "#aaa" }}>password:</span>
              <input
                ref={lockPasswordRef}
                style={{ ...s.inlineInput, width: 160 }}
                type="password"
                placeholder="set a password…"
                value={lockPassword}
                onChange={e => setLockPassword(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") cancelCreate(); }}
              />
            </div>
          )}
        </div>
      )}

      <div style={s.toolbar}>
        <button style={s.btn} onClick={() => { setCreating("page"); setNewName(""); }}>+ page</button>
        <button style={s.btn} onClick={() => { setCreating("folder"); setNewName(""); }}>+ folder</button>
      </div>
    </div>
  );
}
