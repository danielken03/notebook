import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, query, where } from "firebase/firestore";

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
const defaultTree = { type: "folder", children: {} };

// ─── CSS VARIABLES ────────────────────────────────────────────────────────────
// Injected once at module load so all inline styles can reference var(--*)

const styleTag = document.createElement("style");
styleTag.textContent = `
  :root {
    --font:    'Courier New', monospace;
    --bg:      #FFFFFF;
    --text:    #191919;
    --body:    #212121;
    --dim:     #333333;
    --muted:   #333333;
    --subtle:  #555555;
    --pale:    #555555;
    --faint:   #777777;
    --border:  #2C2C2C;
    --line:    #2C2C2C;
    --surface: #f3f3f0;
    --overlay: rgba(0,0,0,0.3);
    --error:   #cc0000;
  }
  :root.dark {
    --bg:      #191919;
    --text:    #F0F0F0;
    --body:    #E0E0E0;
    --dim:     #CCCCCC;
    --muted:   #CCCCCC;
    --subtle:  #AAAAAA;
    --pale:    #AAAAAA;
    --faint:   #888888;
    --border:  #3C3C3C;
    --line:    #3C3C3C;
    --surface: #242424;
    --overlay: rgba(0,0,0,0.6);
    --error:   #ff5555;
  }
  body { background: var(--bg); }
`;
document.head.appendChild(styleTag);

// ─── DARK MODE ────────────────────────────────────────────────────────────────

function applyTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
}

applyTheme(localStorage.getItem("dark") === "true");

function toggleDark() {
  const dark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("dark", dark);
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

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

function getNode(tree, path) {
  let node = tree;
  for (const p of path) node = node.children[p];
  return node;
}

// Like getNode, but returns null instead of throwing if the path no longer exists
// (a share can be edited/deleted remotely while we're looking at it)
function getNodeSafe(tree, path) {
  try { return getNode(tree, path) || null; } catch { return null; }
}

// ─── SHARING ──────────────────────────────────────────────────────────────────
// The share doc is the single live copy of a shared subtree:
//   shared/{id} = { ownerUid, name, tree, allowedEditors, presence }
// The owner's node keeps a `sharedId` marker. The owner pushes to the share doc
// on every save and pulls remote edits back in (on load + live while open).

async function createShare(uid, node, name) {
  const id = Math.random().toString(36).slice(2, 12);
  const subtree = { ...node, sharedId: id };
  await setDoc(doc(db, "shared", id), {
    ownerUid: uid, name, tree: JSON.stringify(subtree), allowedEditors: [], created: Date.now(),
  });
  return id;
}
async function loadShare(id) {
  const snap = await getDoc(doc(db, "shared", id));
  return snap.exists()
    ? { tree: JSON.parse(snap.data().tree), name: snap.data().name, allowedEditors: snap.data().allowedEditors || [] }
    : null;
}
async function saveSharedTree(id, subtree) {
  await setDoc(doc(db, "shared", id), { tree: JSON.stringify(subtree) }, { merge: true });
}
async function saveShareEditors(id, allowedEditors) {
  await setDoc(doc(db, "shared", id), { allowedEditors }, { merge: true });
}
async function deleteShare(id) {
  await deleteDoc(doc(db, "shared", id));
}

// Walk a tree and collect every shared node with its path
function findShared(node, path = [], out = []) {
  if (node.sharedId) out.push({ path, node });
  if (node.children) {
    for (const [name, child] of Object.entries(node.children)) findShared(child, [...path, name], out);
  }
  return out;
}

// Find which share (if any) a node lives inside — nearest sharedId wins
function findShareIdFor(tree, nodePath) {
  let node = tree;
  let id = node.sharedId || null;
  for (const p of nodePath) {
    node = node.children?.[p];
    if (!node) return id;
    if (node.sharedId) id = node.sharedId;
  }
  return id;
}

// Pull each share doc's tree into the owner's tree (share doc is authoritative,
// since editors may have made changes while the owner was away). Saves if changed.
async function syncShares(uid, tree) {
  const shares = findShared(tree);
  if (shares.length === 0) return tree;
  const newTree = JSON.parse(JSON.stringify(tree));
  let changed = false;
  for (const { path } of shares) {
    const node = getNodeSafe(newTree, path);
    if (!node?.sharedId) continue;
    const snap = await getDoc(doc(db, "shared", node.sharedId));
    if (!snap.exists()) {
      // Share was deleted elsewhere — drop the marker
      delete node.sharedId;
      changed = true;
      continue;
    }
    const remote = JSON.parse(snap.data().tree);
    remote.sharedId = node.sharedId;
    if (JSON.stringify(remote) !== JSON.stringify(node)) {
      const parent = getNode(newTree, path.slice(0, -1));
      parent.children[path[path.length - 1]] = remote;
      changed = true;
    }
  }
  if (changed) await save(uid, newTree);
  return newTree;
}

// ─── PRESENCE ─────────────────────────────────────────────────────────────────
// While someone with edit rights has a shared page open, they heartbeat a
// presence entry on the share doc every 10s. Everyone viewing that share sees
// who else is currently there. Entries older than 25s are treated as gone.

function usePresence(shareId, sender) {
  const [names, setNames] = useState([]);
  useEffect(() => {
    if (!shareId) { setNames([]); return; }
    const key = sender?.uid || null;
    let interval;
    if (sender) {
      const name = (sender.displayName || sender.email).split(" ")[0];
      const send = () => setDoc(doc(db, "shared", shareId),
        { presence: { [key]: { name, ts: Date.now() } } }, { merge: true }).catch(() => {});
      send();
      interval = setInterval(send, 10000);
    }
    const unsub = onSnapshot(doc(db, "shared", shareId), snap => {
      const p = snap.data()?.presence || {};
      setNames(Object.entries(p)
        .filter(([k, v]) => k !== key && Date.now() - v.ts < 25000)
        .map(([, v]) => v.name));
    });
    return () => {
      clearInterval(interval);
      unsub();
      // Announce departure so the badge clears promptly for others
      if (sender) setDoc(doc(db, "shared", shareId),
        { presence: { [key]: { name: "", ts: 0 } } }, { merge: true }).catch(() => {});
    };
  }, [shareId, sender?.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  return names;
}

function PresenceBadge({ names }) {
  if (names.length === 0) return null;
  return (
    <span style={{ fontSize: 12, color: "var(--muted)" }}>
      ✏ {names.join(", ")} {names.length === 1 ? "is" : "are"} editing
    </span>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const s = {

  // layout
  app: {
    fontFamily: "var(--font)",
    maxWidth: 680,
    margin: "0 auto",
    padding: "40px 20px",
    minHeight: "100vh",
    background: "var(--bg)",
  },

  // sign-in screen
  signIn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    fontFamily: "var(--font)",
    background: "var(--bg)",
    gap: 16,
  },

  // breadcrumb nav
  crumb: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font)",
    fontSize: 14,
    color: "var(--muted)",
    padding: 0,
    textDecoration: "underline",
  },
  current: {
    fontSize: 14,
    color: "var(--text)",
  },

  // item rows
  row: {
    display: "flex",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
    gap: 8,
  },
  icon: {
    width: 18,
    color: "var(--subtle)",
    fontSize: 13,
    flexShrink: 0,
    textAlign: "center",
  },
  name: {
    flex: 1,
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font)",
    fontSize: 14,
    textAlign: "left",
    padding: 0,
    color: "var(--text)",
  },
  iconBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--faint)",
    fontSize: 12,
    fontFamily: "var(--font)",
    padding: "0 3px",
  },

  // toolbar & buttons
  toolbar: {
    display: "flex",
    gap: 12,
    marginTop: 24,
  },
  btn: {
    background: "none",
    border: "1px solid var(--faint)",
    borderRadius: 2,
    cursor: "pointer",
    fontFamily: "var(--font)",
    fontSize: 13,
    padding: "4px 12px",
    color: "var(--dim)",
  },
  inlineInput: {
    fontFamily: "var(--font)",
    fontSize: 14,
    border: "none",
    borderBottom: "1px solid var(--line)",
    background: "transparent",
    outline: "none",
    width: 200,
    padding: "2px 0",
    color: "var(--text)",
  },

  // page editor
  editor: {
    position: "fixed",
    inset: 0,
    background: "var(--bg)",
    display: "flex",
    flexDirection: "column",
    padding: "32px 40px",
    zIndex: 10,
  },
  textarea: {
    flex: 1,
    fontFamily: "var(--font)",
    fontSize: 14,
    border: "none",
    outline: "none",
    background: "transparent",
    resize: "none",
    lineHeight: 1.7,
    color: "var(--body)",
  },
  back: {
    marginBottom: 24,
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font)",
    fontSize: 13,
    color: "var(--muted)",
    padding: 0,
    textDecoration: "underline",
  },

  // item ⋮ menu
  menu: {
    position: "absolute",
    right: 0,
    top: 22,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 2,
    display: "flex",
    flexDirection: "column",
    zIndex: 51,
    minWidth: 110,
  },
  menuItem: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font)",
    fontSize: 13,
    color: "var(--dim)",
    padding: "8px 14px",
    textAlign: "left",
  },
  menuLabel: {
    fontSize: 10,
    color: "var(--faint)",
    padding: "8px 14px 2px",
    borderBottom: "1px solid var(--border)",
    marginBottom: 2,
  },

  // modals
  modal: {
    position: "fixed",
    inset: 0,
    background: "var(--overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modalBox: {
    background: "var(--bg)",
    padding: "32px",
    fontFamily: "var(--font)",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    minWidth: 280,
    border: "1px solid var(--border)",
  },
  modalInput: {
    fontFamily: "var(--font)",
    fontSize: 14,
    border: "none",
    borderBottom: "1px solid var(--line)",
    background: "transparent",
    outline: "none",
    padding: "4px 0",
    width: "100%",
    color: "var(--text)",
  },
};

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

function DarkToggle() {
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  return (
    <button style={s.iconBtn} title="toggle theme" onClick={() => { toggleDark(); setDark(d => !d); }}>
      {dark ? "○" : "●"}
    </button>
  );
}

function Breadcrumbs({ root, path, setPath, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32, flexWrap: "wrap" }}>
      <button style={s.crumb} onClick={() => setPath([])}>{root}</button>
      {path.map((p, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--faint)", fontSize: 14 }}>/</span>
          {i < path.length - 1
            ? <button style={s.crumb} onClick={() => setPath(path.slice(0, i + 1))}>{p}</button>
            : <span style={s.current}>{p}</span>}
        </span>
      ))}
      <span style={{ flex: 1 }} />
      {children}
    </div>
  );
}

function PasswordModal({ title, onConfirm, onCancel, error }) {
  const [value, setValue] = useState("");
  const inputRef = useRef();
  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  return (
    <div style={s.modal}>
      <div style={s.modalBox}>
        <div style={{ fontSize: 14, color: "var(--text)" }}>🔒 {title}</div>
        <input
          ref={inputRef}
          style={s.modalInput}
          type="password"
          placeholder="enter password…"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") onConfirm(value); if (e.key === "Escape") onCancel(); }}
        />
        {error && <div style={{ fontSize: 12, color: "var(--error)" }}>incorrect password</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.btn} onClick={() => onConfirm(value)}>unlock</button>
          <button style={{ ...s.btn, border: "none" }} onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  );
}

// ⋮ menu shown on each item row — opens a small dropdown with the item actions.
// Clicking anywhere else (via the invisible backdrop) or pressing Escape closes it.
function ItemMenu({ open, onToggle, onRename, onShare, onDelete }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") onToggle(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span style={{ position: "relative" }}>
      <button style={{ ...s.iconBtn, fontSize: 14 }} title="options" onClick={onToggle}>⋮</button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={onToggle} />
          <div style={s.menu}>
            <button style={s.menuItem} onClick={() => { onToggle(); onRename(); }}>✎ rename</button>
            <button style={s.menuItem} onClick={() => { onToggle(); onShare(); }}>↪ share</button>
            <button style={{ ...s.menuItem, color: "var(--error)" }} onClick={() => { onToggle(); onDelete(); }}>✕ delete</button>
          </div>
        </>
      )}
    </span>
  );
}

// Sort & filter dropdown — filter between all / shared / not shared (like an
// email client's all vs unread), and sort by default, a–z, or newest first.
function SortMenu({ sortBy, filterBy, onSort, onFilter }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const item = (label, active, fn) => (
    <button
      style={{ ...s.menuItem, color: active ? "var(--text)" : "var(--dim)" }}
      onClick={() => { fn(); setOpen(false); }}
    >{active ? "✓ " : "· "}{label}</button>
  );

  const filterLabel = filterBy === "shared" ? " · shared" : filterBy === "notshared" ? " · not shared" : "";

  return (
    <span style={{ position: "relative" }}>
      <button style={{ ...s.iconBtn, fontSize: 13 }} title="sort & filter" onClick={() => setOpen(o => !o)}>
        ⇅ sort{filterLabel}
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setOpen(false)} />
          <div style={{ ...s.menu, minWidth: 150 }}>
            <div style={s.menuLabel}>show</div>
            {item("all", filterBy === "all", () => onFilter("all"))}
            {item("shared", filterBy === "shared", () => onFilter("shared"))}
            {item("not shared", filterBy === "notshared", () => onFilter("notshared"))}
            <div style={s.menuLabel}>sort by</div>
            {item("default", sortBy === "default", () => onSort("default"))}
            {item("a–z", sortBy === "alpha", () => onSort("alpha"))}
            {item("newest first", sortBy === "newest", () => onSort("newest"))}
          </div>
        </>
      )}
    </span>
  );
}

// Textarea with debounced autosave (500ms after typing stops), a manual save
// button, and a status indicator. Applies incoming remote updates whenever the
// user isn't actively editing, so live changes appear without clobbering typing.
function AutoSaveArea({ value, onSave, children }) {
  const ref = useRef();
  const timer = useRef(null);
  const pending = useRef(null); // latest unsaved text, null = clean
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const [status, setStatus] = useState("saved");

  // Apply remote updates when not focused and nothing is unsaved locally
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current
        && pending.current === null && ref.current.value !== value) {
      ref.current.value = value;
    }
  }, [value]);

  async function doSave() {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const text = pending.current;
    pending.current = null;
    setStatus("saving");
    await onSaveRef.current(text);
    setStatus("saved");
  }

  function onChange(e) {
    pending.current = e.target.value;
    setStatus("unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(doSave, 500);
  }

  // Flush any unsaved text when leaving the page
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current !== null) onSaveRef.current(pending.current);
  }, []);

  return (
    <>
      <textarea ref={ref} style={s.textarea} defaultValue={value} placeholder="Start writing…"
        onChange={onChange} onBlur={doSave} autoFocus />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button style={s.btn} onClick={doSave}>save</button>
        <span style={{ fontSize: 12, color: "var(--pale)" }}>
          {status === "saved" ? "✓ saved" : status === "saving" ? "saving…" : "unsaved changes…"}
        </span>
        <span style={{ flex: 1 }} />
        {children}
      </div>
    </>
  );
}

// Share modal — creates a link for unshared items, manages an existing share
// (copy link, add/remove editors, stop sharing) for shared ones.
function ShareModal({ name, node, onCreate, onSetEditors, onUnshare, onClose }) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [editors, setEditors] = useState(null); // null = loading from share doc
  const emailRef = useRef();

  const url = node.sharedId ? `${window.location.origin}/#share/${node.sharedId}` : null;

  // Load the current editor list when managing an existing share
  useEffect(() => {
    if (node.sharedId) loadShare(node.sharedId).then(d => setEditors(d?.allowedEditors || []));
  }, [node.sharedId]);

  async function create() {
    setLoading(true);
    await onCreate();
    setLoading(false);
  }

  async function addEmail() {
    const e = emailInput.trim().toLowerCase();
    setEmailInput("");
    if (!e || !e.includes("@") || editors.includes(e)) return;
    const next = [...editors, e];
    setEditors(next);
    await onSetEditors(next);
    if (emailRef.current) emailRef.current.focus();
  }

  async function removeEmail(email) {
    const next = editors.filter(x => x !== email);
    setEditors(next);
    await onSetEditors(next);
  }

  async function stopSharing() {
    if (!confirm(`Stop sharing "${name}"? The link will stop working.`)) return;
    await onUnshare();
    onClose();
  }

  return (
    <div style={s.modal}>
      <div style={{ ...s.modalBox, maxWidth: 360, width: "100%" }}>
        <div style={{ fontSize: 14, color: "var(--text)" }}>share "{name}"</div>

        {!node.sharedId ? (
          <>
            <div style={{ fontSize: 12, color: "var(--subtle)" }}>
              anyone with the link can view a live version. only people you add by email can edit.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...s.btn, flex: 1 }} disabled={loading} onClick={create}>
                {loading ? "…" : "create link"}
              </button>
              <button style={{ ...s.btn, border: "none" }} onClick={onClose}>cancel</button>
            </div>
          </>
        ) : (
          <>
            {/* Link */}
            <div style={{ fontSize: 12, color: "var(--subtle)" }}>anyone with the link can view:</div>
            <div style={{
              fontFamily: "var(--font)", fontSize: 11, color: "var(--dim)", background: "var(--surface)",
              padding: "8px 10px", borderRadius: 2, wordBreak: "break-all", userSelect: "all"
            }}>{url}</div>
            <button style={s.btn} onClick={async () => {
              await navigator.clipboard.writeText(url).catch(() => {});
              setCopied(true);
            }}>
              {copied ? "✓ copied" : "copy link"}
            </button>

            {/* Editors */}
            <div style={{ fontSize: 12, color: "var(--subtle)" }}>can edit (it will appear in their notebook):</div>
            {editors === null ? (
              <div style={{ fontSize: 12, color: "var(--pale)" }}>loading…</div>
            ) : (
              <>
                {editors.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--pale)" }}>no one yet — viewers are read-only</div>
                )}
                {editors.map(e => (
                  <div key={e} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--dim)" }}>
                    <span style={{ flex: 1 }}>✏ {e}</span>
                    <button style={{ ...s.iconBtn, color: "var(--faint)", fontSize: 11 }} onClick={() => removeEmail(e)}>✕</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    ref={emailRef}
                    style={{ ...s.modalInput, flex: 1 }}
                    type="email"
                    placeholder="add editor email…"
                    value={emailInput}
                    onChange={e => setEmailInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } if (e.key === "Escape") onClose(); }}
                  />
                  <button style={s.btn} onClick={addEmail}>add</button>
                </div>
              </>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button style={{ ...s.btn, color: "var(--error)", borderColor: "var(--error)" }} onClick={stopSharing}>stop sharing</button>
              <span style={{ flex: 1 }} />
              <button style={{ ...s.btn, border: "none" }} onClick={onClose}>done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── SHARED VIEW ──────────────────────────────────────────────────────────────

function SharedView({ id }) {
  const [data, setData] = useState(null);     // null = loading, false = not found
  const [path, setPath] = useState([]);
  const [openPage, setOpenPage] = useState(null); // { name, nodePath }
  const [viewer, setViewer] = useState(undefined); // undefined = loading, null = signed out

  // Live subscription — the view updates as the owner or editors save
  useEffect(() => onSnapshot(
    doc(db, "shared", id),
    snap => setData(snap.exists()
      ? { tree: JSON.parse(snap.data().tree), name: snap.data().name, allowedEditors: snap.data().allowedEditors || [] }
      : false),
    () => setData(false)
  ), [id]);
  useEffect(() => onAuthStateChanged(auth, u => setViewer(u || null)), []);

  // If a remote update removed what we're looking at, fall back gracefully
  useEffect(() => {
    if (!data) return;
    if (path.length && !getNodeSafe(data.tree, path)) setPath([]);
    if (openPage && !getNodeSafe(data.tree, openPage.nodePath)) setOpenPage(null);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presence: heartbeat while an editor has a page open; everyone sees who's there
  const viewerEmail = viewer?.email?.toLowerCase() || null;
  const canEdit = !!(data && viewerEmail && data.allowedEditors.includes(viewerEmail));
  const inPage = !!(data && (data.tree.type === "page" || (openPage && getNodeSafe(data.tree, openPage.nodePath))));
  const present = usePresence(inPage ? id : null, canEdit ? viewer : null);

  if (data === null || viewer === undefined) return <div style={{ ...s.signIn, color: "var(--subtle)" }}>loading…</div>;
  if (data === false) return <div style={{ ...s.signIn, color: "var(--subtle)" }}>link not found or no longer shared</div>;

  const root = data.tree;
  const goHome = () => { window.location.hash = ""; };

  const badge = canEdit
    ? <span style={{ fontSize: 12, color: "var(--muted)" }}>shared · you can edit</span>
    : <span style={{ fontSize: 12, color: "var(--pale)" }}>shared · read only</span>;

  // Banner shown to anyone who can't edit — sign in to claim edit access, or switch accounts
  const authBanner = !canEdit && (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 2,
      padding: "12px 16px", marginBottom: 24, display: "flex",
      alignItems: "center", gap: 12, flexWrap: "wrap"
    }}>
      {!viewer ? (
        <>
          <span style={{ fontSize: 13, color: "var(--dim)", flex: 1 }}>viewing read-only · sign in if you've been given edit access</span>
          <button style={s.btn} onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
            sign in with google
          </button>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13, color: "var(--dim)", flex: 1 }}>
            signed in as <strong>{viewer.email}</strong> · view only
          </span>
          <button style={s.btn} onClick={() => signOut(auth)}>switch account</button>
        </>
      )}
    </div>
  );

  // Editors save straight to the share doc; the owner's app pulls it in automatically
  async function savePageContent(content) {
    const newTree = JSON.parse(JSON.stringify(root));
    const target = getNodeSafe(newTree, openPage ? openPage.nodePath : []);
    if (!target) return;
    target.content = content;
    await saveSharedTree(id, newTree);
  }

  // ── Page view ──
  // Content is derived from the live tree, so viewers see edits appear
  const pageNode = openPage ? getNodeSafe(root, openPage.nodePath) : null;
  if (root.type === "page" || pageNode) {
    const content = pageNode ? pageNode.content : root.content;
    const name = openPage ? openPage.name : data.name;
    return (
      <div style={s.editor}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 12 }}>
          {openPage
            ? <button style={{ ...s.back, marginBottom: 0 }} onClick={() => setOpenPage(null)}>← back</button>
            : viewer && <button style={{ ...s.back, marginBottom: 0 }} onClick={goHome}>← my notebook</button>}
          <span style={{ flex: 1 }} />
          <PresenceBadge names={present} />
          <DarkToggle />
        </div>
        {authBanner}
        <div style={{ fontSize: 18, marginBottom: 12, color: "var(--text)" }}>{name}</div>
        {canEdit
          ? <AutoSaveArea value={content} onSave={savePageContent}>{badge}</AutoSaveArea>
          : <>
              <div style={{ ...s.textarea, whiteSpace: "pre-wrap", overflow: "auto" }}>{content || <span style={{ color: "var(--pale)" }}>empty page</span>}</div>
              <div style={{ marginTop: 16 }}>{badge}</div>
            </>
        }
      </div>
    );
  }

  // ── Folder view ──
  const folder = getNodeSafe(root, path) || root;
  const items = Object.entries(folder.children).sort(([,a],[,b]) =>
    a.type === b.type ? 0 : a.type === "folder" ? -1 : 1
  );

  return (
    <div style={s.app}>
      <Breadcrumbs root={data.name} path={path} setPath={setPath}>
        {viewer && <button style={s.crumb} onClick={goHome}>my notebook</button>}
        <DarkToggle />
        {badge}
      </Breadcrumbs>

      {authBanner}

      {/* Items list */}
      {items.map(([name, node]) => (
        <div key={name} style={s.row}>
          <span style={s.icon}>{node.type === "folder" ? "▶" : "·"}</span>
          <button style={s.name} onClick={() =>
            node.type === "folder"
              ? setPath([...path, name])
              : setOpenPage({ name, nodePath: [...path, name] })
          }>{name}</button>
        </div>
      ))}
      {items.length === 0 && <div style={{ color: "var(--pale)", fontSize: 13 }}>empty</div>}
    </div>
  );
}

// ─── NOTEBOOK (owner's app) ───────────────────────────────────────────────────

function Notebook() {
  // Navigation & content state
  const [user, setUser] = useState(undefined);
  const [tree, setTree] = useState(null);
  const [path, setPath] = useState([]);
  const [openPage, setOpenPage] = useState(null); // { name }

  // Create / rename state
  const [creating, setCreating] = useState(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [renameTo, setRenameTo] = useState("");

  // Lock state (during item creation)
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockPassword, setLockPassword] = useState("");

  // Password prompt state (when opening a locked item)
  const [promptFor, setPromptFor] = useState(null); // { name, node, action: "open"|"enter" }
  const [promptError, setPromptError] = useState(false);

  // Share modal state — node is looked up from the tree so it stays fresh
  const [shareModal, setShareModal] = useState(null); // { name }

  // Which item's ⋮ menu is open (item name, or null)
  const [menuFor, setMenuFor] = useState(null);

  // Sort & filter, persisted like the dark-mode preference
  const [sortBy, setSortBy] = useState(localStorage.getItem("sortBy") || "default");   // default | alpha | newest
  const [filterBy, setFilterBy] = useState(localStorage.getItem("filterBy") || "all"); // all | shared | notshared
  const setSort = v => { setSortBy(v); localStorage.setItem("sortBy", v); };
  const setFilter = v => { setFilterBy(v); localStorage.setItem("filterBy", v); };

  // Items other people have shared with this account (by editor email)
  const [sharedWithMe, setSharedWithMe] = useState([]);

  // Refs for auto-focusing inputs
  const inputRef = useRef();
  const renameRef = useRef();
  const lockPasswordRef = useRef();

  // Latest tree, readable inside the share listeners without re-subscribing
  const treeRef = useRef(null);
  treeRef.current = tree;

  // Auto-focus inputs when their state activates
  useEffect(() => { if (creating && inputRef.current) inputRef.current.focus(); }, [creating]);
  useEffect(() => { if (renaming && renameRef.current) renameRef.current.focus(); }, [renaming]);
  useEffect(() => { if (lockEnabled && lockPasswordRef.current) lockPasswordRef.current.focus(); }, [lockEnabled]);

  // Load the user's tree from Firestore on sign-in, then pull in any editor
  // changes that happened in shared subtrees while the owner was away
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    if (u) {
      const loaded = await load(u.uid);
      setTree(await syncShares(u.uid, loaded));
    } else {
      setTree(null);
    }
  }), []);

  // Live "shared with me": any share doc listing this account's email as editor
  useEffect(() => {
    if (!user?.email) { setSharedWithMe([]); return; }
    const q = query(collection(db, "shared"), where("allowedEditors", "array-contains", user.email.toLowerCase()));
    return onSnapshot(q, snap =>
      setSharedWithMe(snap.docs
        .filter(d => d.data().ownerUid !== user.uid)
        .map(d => {
          let type = "page";
          try { type = JSON.parse(d.data().tree).type; } catch { /* keep default */ }
          return { id: d.id, name: d.data().name, type, created: d.data().created || 0 };
        })
      ), () => setSharedWithMe([]));
  }, [user]);

  // Live-sync shared subtrees while the app is open: when an editor saves,
  // merge their change into the local tree and persist it
  const shareIds = tree ? findShared(tree).map(e => e.node.sharedId).sort().join(",") : "";
  useEffect(() => {
    if (!user || !shareIds) return;
    const unsubs = shareIds.split(",").map(shareId =>
      onSnapshot(doc(db, "shared", shareId), snap => {
        if (snap.metadata.hasPendingWrites || !treeRef.current) return; // ignore our own writes
        const entry = findShared(treeRef.current).find(e => e.node.sharedId === shareId);
        if (!entry) return;
        const newTree = JSON.parse(JSON.stringify(treeRef.current));
        if (!snap.exists()) {
          // Share deleted elsewhere — drop the marker
          delete getNode(newTree, entry.path).sharedId;
        } else {
          const remote = JSON.parse(snap.data().tree);
          remote.sharedId = shareId;
          if (JSON.stringify(remote) === JSON.stringify(entry.node)) return; // already in sync
          const parent = getNode(newTree, entry.path.slice(0, -1));
          parent.children[entry.path[entry.path.length - 1]] = remote;
        }
        setTree(newTree);
        save(user.uid, newTree); // save directly — no push back to share docs (avoids loops)
      })
    );
    return () => unsubs.forEach(u => u());
  }, [user, shareIds]);

  // Close the open page if a remote update deleted it
  useEffect(() => {
    if (openPage && tree && !getNodeSafe(tree, [...path, openPage.name])) setOpenPage(null);
  }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presence: if the open page lives inside a shared subtree, announce and listen
  const activeShareId = tree && openPage ? findShareIdFor(tree, [...path, openPage.name]) : null;
  const present = usePresence(activeShareId, user || null);

  // Save tree to Firestore, update local state, and push shared subtrees live
  function update(newTree) {
    setTree(newTree);
    save(user.uid, newTree);
    for (const { path: p, node } of findShared(newTree)) {
      setDoc(doc(db, "shared", node.sharedId), {
        tree: JSON.stringify(node), name: p[p.length - 1],
      }, { merge: true });
    }
  }

  // Verify password then open the locked item
  async function handlePromptConfirm(password) {
    if (!promptFor) return;
    const { name, node, action } = promptFor;
    const hash = await hashPassword(password);
    if (hash !== node.passwordHash) {
      setPromptError(true);
      return;
    }
    setPromptFor(null);
    setPromptError(false);
    if (action === "open") {
      if (node.type === "folder") setPath([...path, name]);
      else setOpenPage({ name });
    }
  }

  // Open item — prompt for password if locked, otherwise navigate directly
  function handleItemClick(name, node) {
    if (node.locked) {
      setPromptFor({ name, node, action: "open" });
      setPromptError(false);
      return;
    }
    if (node.type === "folder") setPath([...path, name]);
    else setOpenPage({ name });
  }

  // Create a new page or folder (with optional password lock)
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
      ? { type: "folder", children: {}, created: Date.now(), ...(passwordHash && { locked: true, passwordHash }) }
      : { type: "page", content: "", created: Date.now(), ...(passwordHash && { locked: true, passwordHash }) };

    getNode(newTree, path).children[name] = newNode;
    update(newTree);
    setCreating(null);
    setNewName("");
    setLockEnabled(false);
    setLockPassword("");
  }

  // Cancel the create form and reset its state
  function cancelCreate() {
    setCreating(null);
    setNewName("");
    setLockEnabled(false);
    setLockPassword("");
  }

  // Delete an item (with confirmation) — also deletes any share docs inside it
  function deleteItem(name) {
    if (!confirm(`Delete "${name}"?`)) return;
    for (const { node } of findShared(folder.children[name], [name])) deleteShare(node.sharedId);
    const newTree = JSON.parse(JSON.stringify(tree));
    delete getNode(newTree, path).children[name];
    update(newTree);
    if (openPage?.name === name) setOpenPage(null);
  }

  // Rename an item inline
  function rename(oldName) {
    const n = renameTo.trim();
    if (!n || n === oldName || folder.children[n]) { setRenaming(null); return; }
    const newTree = JSON.parse(JSON.stringify(tree));
    const node = getNode(newTree, path);
    node.children[n] = node.children[oldName];
    delete node.children[oldName];
    update(newTree);
    setRenaming(null);
    if (openPage?.name === oldName) setOpenPage({ name: n });
  }

  // ── Share actions (wired into ShareModal) ──

  // Create the share doc and mark the node with its id
  async function shareItem() {
    const { name } = shareModal;
    const id = await createShare(user.uid, folder.children[name], name);
    const newTree = JSON.parse(JSON.stringify(tree));
    getNode(newTree, path).children[name].sharedId = id;
    update(newTree);
  }

  // Delete the share doc and remove the marker
  async function unshareItem() {
    const { name } = shareModal;
    await deleteShare(folder.children[name].sharedId);
    const newTree = JSON.parse(JSON.stringify(tree));
    delete getNode(newTree, path).children[name].sharedId;
    update(newTree);
  }

  // Save page content back into the tree
  function savePage(content) {
    const newTree = JSON.parse(JSON.stringify(tree));
    const node = getNodeSafe(newTree, [...path, openPage.name]);
    if (!node) return;
    node.content = content;
    update(newTree);
  }

  // ── Loading / sign-in screens ──
  if (user === undefined) return <div style={{ ...s.signIn, color: "var(--subtle)" }}>loading…</div>;
  if (!user) return (
    <div style={s.signIn}>
      <div style={{ fontSize: 18, color: "var(--text)" }}>notebook</div>
      <button style={s.btn} onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>sign in with google</button>
      <a href="/private-policy.html" style={{ fontSize: 12, color: "var(--subtle)", marginTop: 24, textDecoration: "underline", fontFamily: "var(--font)" }}>privacy policy</a>
    </div>
  );
  if (!tree) return <div style={{ ...s.signIn, color: "var(--subtle)" }}>loading…</div>;

  const folder = getNode(tree, path);

  // ── Build the item list: own items + shared-with-me (at root), filtered & sorted ──
  // Entries: { kind: "own"|"sharedWithMe", name, node, created, index, shareId? }
  let entries = Object.entries(folder.children).map(([name, node], index) => ({
    kind: "own", name, node, created: node.created || 0, index,
  }));
  if (path.length === 0) {
    entries = entries.concat(sharedWithMe.map((sh, i) => ({
      kind: "sharedWithMe", name: sh.name, node: { type: sh.type },
      created: sh.created, index: 100000 + i, shareId: sh.id,
    })));
  }

  if (filterBy === "shared") entries = entries.filter(e => e.kind === "sharedWithMe" || e.node.sharedId);
  if (filterBy === "notshared") entries = entries.filter(e => e.kind === "own" && !e.node.sharedId);

  // Folders always sit above pages; the chosen sort applies within each group.
  // Items created before timestamps existed have created=0, so the index
  // tiebreaker keeps them in their original (creation) order.
  const rank = e => e.node.type === "folder" ? 0 : 1;
  entries.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (sortBy === "alpha") return a.name.localeCompare(b.name);
    if (sortBy === "newest") return (b.created - a.created) || (a.index - b.index);
    return (a.created - b.created) || (a.index - b.index); // default: creation order
  });

  // ── Page editor view ──
  if (openPage) {
    const openNode = getNodeSafe(tree, [...path, openPage.name]);
    return (
      <div style={s.editor}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 12 }}>
          <button style={{ ...s.back, marginBottom: 0 }} onClick={() => setOpenPage(null)}>← back</button>
          <span style={{ flex: 1 }} />
          <PresenceBadge names={present} />
          <DarkToggle />
        </div>
        <div style={{ fontSize: 18, marginBottom: 16, color: "var(--text)" }}>{openPage.name}</div>
        <AutoSaveArea value={openNode?.content ?? ""} onSave={savePage} />
      </div>
    );
  }

  // ── Main folder view ──
  return (
    <div style={s.app}>

      {/* Modals */}
      {shareModal && folder.children[shareModal.name] && (
        <ShareModal
          name={shareModal.name}
          node={folder.children[shareModal.name]}
          onCreate={shareItem}
          onSetEditors={emails => saveShareEditors(folder.children[shareModal.name].sharedId, emails)}
          onUnshare={unshareItem}
          onClose={() => setShareModal(null)}
        />
      )}
      {promptFor && (
        <PasswordModal
          title={`"${promptFor.name}" is locked`}
          onConfirm={handlePromptConfirm}
          onCancel={() => { setPromptFor(null); setPromptError(false); }}
          error={promptError}
        />
      )}

      {/* Breadcrumb nav */}
      <Breadcrumbs root="notebook" path={path} setPath={setPath}>
        <DarkToggle />
        <button style={s.crumb} onClick={() => signOut(auth)}>{user.displayName} · sign out</button>
      </Breadcrumbs>

      {/* Sort & filter row */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <SortMenu sortBy={sortBy} filterBy={filterBy} onSort={setSort} onFilter={setFilter} />
      </div>

      {/* Items list */}
      {entries.length === 0 && !creating && (
        <div style={{ color: "var(--pale)", fontSize: 13, marginBottom: 24 }}>
          {filterBy === "all" ? "empty — add something below" : "nothing matches this filter"}
        </div>
      )}
      {entries.map(e => e.kind === "own" ? (
        <div key={e.name} style={s.row}>
          <span style={s.icon}>{e.node.type === "folder" ? "▶" : "·"}</span>
          {renaming === e.name ? (
            <input ref={renameRef} style={s.inlineInput} value={renameTo}
              onChange={ev => setRenameTo(ev.target.value)}
              onKeyDown={ev => { if (ev.key === "Enter") rename(e.name); if (ev.key === "Escape") setRenaming(null); }}
              onBlur={() => rename(e.name)} />
          ) : (
            <button style={s.name} onClick={() => handleItemClick(e.name, e.node)}>
              {e.node.locked ? "🔒 " : ""}{e.name}
            </button>
          )}
          {e.node.sharedId && <span style={{ fontSize: 11, color: "var(--faint)" }} title="shared">↪ shared</span>}
          <ItemMenu
            open={menuFor === e.name}
            onToggle={() => setMenuFor(menuFor === e.name ? null : e.name)}
            onRename={() => { setRenaming(e.name); setRenameTo(e.name); }}
            onShare={() => setShareModal({ name: e.name })}
            onDelete={() => deleteItem(e.name)}
          />
        </div>
      ) : (
        <div key={`swm-${e.shareId}`} style={s.row}>
          <span style={s.icon}>{e.node.type === "folder" ? "▶" : "·"}</span>
          <button style={s.name} onClick={() => { window.location.hash = `share/${e.shareId}`; }}>{e.name}</button>
          <span style={{ fontSize: 11, color: "var(--faint)" }} title="someone shared this with you">↪ shared with me</span>
        </div>
      ))}

      {/* Create row */}
      {creating && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={s.icon}>{creating === "folder" ? "▶" : "·"}</span>
            <input ref={inputRef} style={s.inlineInput} value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !lockEnabled) create(); if (e.key === "Escape") cancelCreate(); }}
              placeholder={`${creating} name…`} />
            <button
              style={{ ...s.iconBtn, color: lockEnabled ? "var(--dim)" : "var(--faint)", fontSize: 14 }}
              title={lockEnabled ? "remove lock" : "add lock"}
              onClick={() => { setLockEnabled(v => !v); setLockPassword(""); }}
            >🔒</button>
            <button style={s.btn} onClick={create}>ok</button>
            <button style={{ ...s.btn, border: "none" }} onClick={cancelCreate}>cancel</button>
          </div>
          {lockEnabled && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 26 }}>
              <span style={{ fontSize: 12, color: "var(--subtle)" }}>password:</span>
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

      {/* Toolbar */}
      <div style={s.toolbar}>
        <button style={s.btn} onClick={() => { setCreating("page"); setNewName(""); }}>+ page</button>
        <button style={s.btn} onClick={() => { setCreating("folder"); setNewName(""); }}>+ folder</button>
      </div>

    </div>
  );
}

// ─── MAIN APP (router) ────────────────────────────────────────────────────────
// Switches between the owner's notebook and a shared view based on the URL
// hash, and reacts to hash changes so navigation works without a page reload.

export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const shareMatch = hash.match(/^#share\/(.+)/);
  return shareMatch
    ? <SharedView key={shareMatch[1]} id={shareMatch[1]} />
    : <Notebook />;
}
