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
async function createShare(subtree, name, allowedEditors = []) {
  const id = Math.random().toString(36).slice(2, 12);
  const normalized = allowedEditors.map(e => e.trim().toLowerCase()).filter(Boolean);
  await setDoc(doc(db, "shared", id), { tree: JSON.stringify(subtree), name, allowedEditors: normalized });
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
function getNode(tree, path) {
  let node = tree;
  for (const p of path) node = node.children[p];
  return node;
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

function ShareModal({ name, onShare, onClose }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [editors, setEditors] = useState([]);
  const emailRef = useRef();

  function addEmail() {
    const e = emailInput.trim().toLowerCase();
    if (!e || editors.includes(e)) { setEmailInput(""); return; }
    setEditors(prev => [...prev, e]);
    setEmailInput("");
    if (emailRef.current) emailRef.current.focus();
  }

  async function handleShare() {
    setLoading(true);
    // Include any email still typed in the input but not yet added
    const pending = emailInput.trim().toLowerCase();
    const finalEditors = pending && !editors.includes(pending) ? [...editors, pending] : editors;
    const shareUrl = await onShare(finalEditors);
    setUrl(shareUrl);
    setLoading(false);
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    setCopied(true);
  }

  return (
    <div style={s.modal}>
      <div style={{ ...s.modalBox, maxWidth: 360, width: "100%" }}>
        <div style={{ fontSize: 14, color: "var(--text)" }}>share "{name}"</div>

        {!url ? (
          <>
            <div style={{ fontSize: 12, color: "var(--subtle)" }}>
              anyone with the link can view. add emails below to grant edit access.
            </div>

            {/* Email input */}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={emailRef}
                style={{ ...s.modalInput, flex: 1 }}
                type="email"
                placeholder="editor email address…"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } if (e.key === "Escape") onClose(); }}
              />
              <button style={s.btn} onClick={addEmail}>add</button>
            </div>

            {/* Editor list */}
            {editors.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11, color: "var(--subtle)", marginBottom: 2 }}>can edit:</div>
                {editors.map(e => (
                  <div key={e} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--dim)" }}>
                    <span style={{ flex: 1 }}>✏ {e}</span>
                    <button style={{ ...s.iconBtn, color: "var(--faint)", fontSize: 11 }} onClick={() => setEditors(prev => prev.filter(x => x !== e))}>✕</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button style={{ ...s.btn, flex: 1 }} disabled={loading} onClick={handleShare}>
                {loading ? "…" : "create link"}
              </button>
              <button style={{ ...s.btn, border: "none" }} onClick={onClose}>cancel</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "var(--subtle)" }}>
              link ready — anyone can view{editors.length > 0 ? `, ${editors.length === 1 ? "1 person" : `${editors.length} people`} can edit` : ""}:
            </div>
            <div style={{
              fontFamily: "var(--font)", fontSize: 11, color: "var(--dim)", background: "var(--surface)",
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

// ─── SHARED VIEW ──────────────────────────────────────────────────────────────

function SharedView({ id }) {
  const [data, setData] = useState(null);
  const [path, setPath] = useState([]);
  const [openPage, setOpenPage] = useState(null);
  const [viewer, setViewer] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => { loadShare(id).then(d => setData(d || false)); }, [id]);
  useEffect(() => onAuthStateChanged(auth, u => setViewer(u || null)), []);

  if (data === null || viewer === undefined) return <div style={{ ...s.signIn, color: "var(--subtle)" }}>loading…</div>;
  if (data === false) return <div style={{ ...s.signIn, color: "var(--subtle)" }}>link not found</div>;

  const root = data.tree;
  const viewerEmail = viewer?.email?.toLowerCase() || null;
  const editorsExist = data.allowedEditors.length > 0;
  const canEdit = editorsExist && viewerEmail && data.allowedEditors.includes(viewerEmail);
  const wrongAccount = editorsExist && viewer && !canEdit;

  const badge = canEdit
    ? <span style={{ fontSize: 12, color: "var(--muted)" }}>shared · you can edit</span>
    : <span style={{ fontSize: 12, color: "var(--pale)" }}>shared · read only</span>;

  // Prominent auth banner shown when edit access exists but viewer can't edit
  const authBanner = editorsExist && !canEdit && (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 2,
      padding: "12px 16px", marginBottom: 24, display: "flex",
      alignItems: "center", gap: 12, flexWrap: "wrap"
    }}>
      {!viewer ? (
        <>
          <span style={{ fontSize: 13, color: "var(--dim)", flex: 1 }}>this link has edit access for certain accounts</span>
          <button style={s.btn} onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
            sign in with google
          </button>
        </>
      ) : wrongAccount ? (
        <>
          <span style={{ fontSize: 13, color: "var(--dim)", flex: 1 }}>
            signed in as <strong>{viewer.email}</strong> · not on the edit list
          </span>
          <button style={s.btn} onClick={() => signOut(auth)}>switch account</button>
        </>
      ) : null}
    </div>
  );

  // Save an edited page back to Firestore
  async function savePageContent(content) {
    const newTree = JSON.parse(JSON.stringify(root));
    const node = openPage.nodePath.reduce((n, p) => n.children[p], newTree);
    node.content = content;
    setData({ ...data, tree: newTree });
    setOpenPage({ ...openPage, content });
    await saveSharedTree(id, newTree);
  }

  // ── Page editor view ──
  if (root.type === "page" || openPage) {
    const content = openPage ? openPage.content : root.content;
    const name = openPage ? openPage.name : data.name;
    return (
      <div style={s.editor}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 12 }}>
          {openPage && <button style={{ ...s.back, marginBottom: 0 }} onClick={() => setOpenPage(null)}>← back</button>}
          <span style={{ flex: 1 }} />
          <DarkToggle />
        </div>
        {authBanner}
        <div style={{ fontSize: 18, marginBottom: 12, color: "var(--text)" }}>{name}</div>
        {canEdit
          ? <textarea style={s.textarea} defaultValue={content} placeholder="Start writing…" onBlur={e => savePageContent(e.target.value)} autoFocus />
          : <div style={{ ...s.textarea, whiteSpace: "pre-wrap", overflow: "auto" }}>{content || <span style={{ color: "var(--pale)" }}>empty page</span>}</div>
        }
        <div style={{ marginTop: 16 }}>{badge}</div>
      </div>
    );
  }

  // ── Folder view ──
  const folder = getNode(root, path);
  const items = Object.entries(folder.children).sort(([,a],[,b]) =>
    a.type === b.type ? 0 : a.type === "folder" ? -1 : 1
  );

  return (
    <div style={s.app}>
      <Breadcrumbs root={data.name} path={path} setPath={setPath}>
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
              : setOpenPage({ name, content: node.content, nodePath: [...path, name] })
          }>{name}</button>
        </div>
      ))}
      {items.length === 0 && <div style={{ color: "var(--pale)", fontSize: 13 }}>empty</div>}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const shareMatch = window.location.hash.match(/^#share\/(.+)/);
  if (shareMatch) return <SharedView id={shareMatch[1]} />;

  // Navigation & content state
  const [user, setUser] = useState(undefined);
  const [tree, setTree] = useState(null);
  const [path, setPath] = useState([]);
  const [openPage, setOpenPage] = useState(null);

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

  // Share modal state
  const [shareModal, setShareModal] = useState(null); // { name, node }

  // Refs for auto-focusing inputs
  const inputRef = useRef();
  const renameRef = useRef();
  const lockPasswordRef = useRef();

  // Auto-focus inputs when their state activates
  useEffect(() => { if (creating && inputRef.current) inputRef.current.focus(); }, [creating]);
  useEffect(() => { if (renaming && renameRef.current) renameRef.current.focus(); }, [renaming]);
  useEffect(() => { if (lockEnabled && lockPasswordRef.current) lockPasswordRef.current.focus(); }, [lockEnabled]);

  // Load the user's tree from Firestore on sign-in
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    if (u) setTree(await load(u.uid));
    else setTree(null);
  }), []);

  // Save tree to Firestore and update local state
  function update(newTree) { setTree(newTree); save(user.uid, newTree); }

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
      if (node.type === "folder") {
        setPath([...path, name]);
      } else {
        setOpenPage({ name, content: node.content });
      }
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
    else setOpenPage({ name, content: node.content });
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
      ? { type: "folder", children: {}, ...(passwordHash && { locked: true, passwordHash }) }
      : { type: "page", content: "", ...(passwordHash && { locked: true, passwordHash }) };

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

  // Delete an item (with confirmation)
  function deleteItem(name) {
    if (!confirm(`Delete "${name}"?`)) return;
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
    if (openPage?.name === oldName) setOpenPage({ ...openPage, name: n });
  }

  // Open the share modal for an item
  function openShare(name, node) {
    setShareModal({ name, node });
  }

  // Create a share link and return its URL
  async function doShare(allowedEditors) {
    const { name, node } = shareModal;
    const id = await createShare(node, name, allowedEditors);
    return `${window.location.origin}/#share/${id}`;
  }

  // Save page content back into the tree
  function savePage(content) {
    const newTree = JSON.parse(JSON.stringify(tree));
    getNode(newTree, [...path, openPage.name]).content = content;
    update(newTree);
    setOpenPage({ ...openPage, content });
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
  const items = Object.entries(folder.children).sort(([,a],[,b]) =>
    a.type === b.type ? 0 : a.type === "folder" ? -1 : 1
  );

  // ── Page editor view ──
  if (openPage) return (
    <div style={s.editor}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 12 }}>
        <button style={{ ...s.back, marginBottom: 0 }} onClick={() => setOpenPage(null)}>← back</button>
        <span style={{ flex: 1 }} />
        <DarkToggle />
      </div>
      <div style={{ fontSize: 18, marginBottom: 16, color: "var(--text)" }}>{openPage.name}</div>
      <textarea style={s.textarea} defaultValue={openPage.content} placeholder="Start writing…" onBlur={e => savePage(e.target.value)} autoFocus />
    </div>
  );

  // ── Main folder view ──
  return (
    <div style={s.app}>

      {/* Modals */}
      {shareModal && (
        <ShareModal
          name={shareModal.name}
          onShare={doShare}
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

      {/* Items list */}
      {items.length === 0 && !creating && (
        <div style={{ color: "var(--pale)", fontSize: 13, marginBottom: 24 }}>empty — add something below</div>
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
              {node.locked ? "🔒 " : ""}{name}
            </button>
          )}
          <button style={s.iconBtn} title="rename" onClick={() => { setRenaming(name); setRenameTo(name); }}>✎</button>
          <button style={s.iconBtn} title="share" onClick={() => openShare(name, node)}>⤴</button>
          <button style={s.iconBtn} onClick={() => deleteItem(name)}>✕</button>
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