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

async function save(uid, tree) {
  await setDoc(doc(db, "notebooks", uid), { tree: JSON.stringify(tree) });
}
async function load(uid) {
  const snap = await getDoc(doc(db, "notebooks", uid));
  return snap.exists() ? JSON.parse(snap.data().tree) : defaultTree;
}
async function createShare(subtree, name) {
  const id = Math.random().toString(36).slice(2, 12);
  await setDoc(doc(db, "shared", id), { tree: JSON.stringify(subtree), name });
  return id;
}
async function loadShare(id) {
  const snap = await getDoc(doc(db, "shared", id));
  return snap.exists() ? { tree: JSON.parse(snap.data().tree), name: snap.data().name } : null;
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
};

function SharedView({ id }) {
  const [data, setData] = useState(null);
  const [path, setPath] = useState([]);
  const [openPage, setOpenPage] = useState(null);

  useEffect(() => { loadShare(id).then(d => setData(d || false)); }, [id]);

  if (data === null) return <div style={{ ...s.signIn, color: "#aaa" }}>loading…</div>;
  if (data === false) return <div style={{ ...s.signIn, color: "#aaa" }}>link not found</div>;

  const root = data.tree;

  if (root.type === "page" || openPage) {
    const content = openPage ? openPage.content : root.content;
    const name = openPage ? openPage.name : data.name;
    return (
      <div style={s.editor}>
        {openPage && <button style={s.back} onClick={() => setOpenPage(null)}>← back</button>}
        <div style={{ fontSize: 18, marginBottom: 16, color: "#222" }}>{name}</div>
        <div style={{ ...s.textarea, whiteSpace: "pre-wrap", overflow: "auto" }}>{content || <span style={{ color: "#bbb" }}>empty page</span>}</div>
        <div style={{ marginTop: 16, fontSize: 12, color: "#bbb" }}>shared · read only</div>
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
        <span style={{ fontSize: 12, color: "#bbb" }}>shared · read only</span>
      </div>
      {items.map(([name, node]) => (
        <div key={name} style={s.row}>
          <span style={s.icon}>{node.type === "folder" ? "▶" : "·"}</span>
          <button style={s.name} onClick={() =>
            node.type === "folder" ? setPath([...path, name]) : setOpenPage({ name, content: node.content })
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
  const inputRef = useRef();
  const renameRef = useRef();

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    if (u) setTree(await load(u.uid));
    else setTree(null);
  }), []);

  useEffect(() => { if (creating && inputRef.current) inputRef.current.focus(); }, [creating]);
  useEffect(() => { if (renaming && renameRef.current) renameRef.current.focus(); }, [renaming]);

  function update(newTree) { setTree(newTree); save(user.uid, newTree); }

  function create() {
    const name = newName.trim();
    if (!name || folder.children[name]) return;
    const newTree = JSON.parse(JSON.stringify(tree));
    getNode(newTree, path).children[name] = creating === "folder"
      ? { type: "folder", children: {} }
      : { type: "page", content: "" };
    update(newTree);
    setCreating(null); setNewName("");
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

  async function share(name, node) {
    const id = await createShare(node, name);
    const url = `${window.location.origin}/#share/${id}`;
    await navigator.clipboard.writeText(url);
    setCopied(name);
    setTimeout(() => setCopied(null), 2000);
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
            <button style={s.name} onClick={() =>
              node.type === "folder" ? setPath([...path, name]) : setOpenPage({ name, content: node.content })
            }>{name}</button>
          )}
          <button style={s.iconBtn} title="rename" onClick={() => { setRenaming(name); setRenameTo(name); }}>✎</button>
          <button style={s.iconBtn} title="share" onClick={() => share(name, node)}>{copied === name ? "✓" : "⤴"}</button>
          <button style={s.iconBtn} onClick={() => deleteItem(name)}>✕</button>
        </div>
      ))}

      {creating && (
        <div style={{ ...s.row, gap: 8 }}>
          <span style={s.icon}>{creating === "folder" ? "▶" : "·"}</span>
          <input ref={inputRef} style={s.inlineInput} value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") { setCreating(null); setNewName(""); } }}
            placeholder={`${creating} name…`} />
          <button style={s.btn} onClick={create}>ok</button>
          <button style={{ ...s.btn, border: "none" }} onClick={() => { setCreating(null); setNewName(""); }}>cancel</button>
        </div>
      )}

      <div style={s.toolbar}>
        <button style={s.btn} onClick={() => { setCreating("page"); setNewName(""); }}>+ page</button>
        <button style={s.btn} onClick={() => { setCreating("folder"); setNewName(""); }}>+ folder</button>
      </div>
    </div>
  );
}