const COOKIE_NAME = "elyndor_admin";
const SESSION_SECONDS = 60 * 60 * 8;
const CONTENT_KEY = "site-content-v1";
const LOG_PREFIX = "changelog:";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  }
});

function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return "";
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function createSession(secret) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    nonce: base64url(crypto.getRandomValues(new Uint8Array(16)))
  })));
  const signature = base64url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

async function validSession(request, secret) {
  if (!secret) return false;
  const token = cookieValue(request, COOKIE_NAME);
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const expected = await hmac(secret, parts[0]);
    const supplied = fromBase64url(parts[1]);
    if (expected.length !== supplied.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ supplied[i];
    if (diff !== 0) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    return Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function cookieHeader(value, maxAge) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function readContent(env) {
  const stored = await env.SITE_CONTENT.get(CONTENT_KEY, "json");
  if (stored && typeof stored === "object") return stored;
  return {
    announcement: "Elyndor is in active development.",
    headline: "A world taking shape.",
    status: "Core world foundation",
    updatedAt: new Date().toISOString(),
    updates: [
      {
        title: "Player movement and collision",
        body: "Walking and jumping work in the current development build; ground collision has been detected during testing.",
        status: "Working"
      },
      {
        title: "Terrain streaming performance",
        body: "Investigating frame drops when exploring newly generated terrain.",
        status: "In progress"
      }
    ]
  };
}

async function listChangelog(env) {
  const listed = await env.SITE_CONTENT.list({ prefix: LOG_PREFIX, limit: 1000 });
  const entries = await Promise.all(listed.keys.map(async item => {
    const value = await env.SITE_CONTENT.get(item.name, "json");
    return value && typeof value === "object" ? value : null;
  }));
  return entries.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function validateLog(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid log entry");
  const entry = {
    id: safeText(input.id, 100),
    title: safeText(input.title, 140),
    category: safeText(input.category, 40) || "Development",
    body: safeText(input.body, 5000),
    createdAt: safeText(input.createdAt, 40)
  };
  if (!entry.title || !entry.body) throw new Error("Add a title and details first");
  if (!entry.id) entry.id = `${Date.now()}-${base64url(crypto.getRandomValues(new Uint8Array(9)))}`;
  if (!entry.createdAt || Number.isNaN(Date.parse(entry.createdAt))) entry.createdAt = new Date().toISOString();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id)) throw new Error("Invalid log ID");
  return entry;
}

const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Elyndor Admin</title>
<style>
:root{color-scheme:dark;--bg:#111410;--panel:#191d17;--ink:#eee8d8;--muted:#b6b5a7;--gold:#d9bd7b;--line:#3b4234}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{width:min(860px,calc(100% - 32px));margin:48px auto}.eyebrow{color:var(--gold);letter-spacing:.16em;text-transform:uppercase;font-size:.75rem;font-weight:700}
h1{font:500 clamp(2rem,6vw,3.6rem)/1.1 Georgia,serif;margin:10px 0}p{color:var(--muted)}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:22px;margin:20px 0}
label{display:block;font-weight:650;margin:16px 0 6px}input,textarea{display:block;width:100%;padding:12px;border:1px solid #515746;border-radius:5px;background:#10130f;color:var(--ink);font:inherit}textarea{min-height:110px;resize:vertical}
button{border:1px solid var(--gold);background:var(--gold);color:#171811;font:700 1rem system-ui;padding:12px 18px;border-radius:5px;cursor:pointer;margin-top:16px}button.secondary{background:transparent;color:var(--ink);border-color:var(--line);margin-left:8px}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1;min-width:180px}.message{min-height:1.5em;color:var(--gold)}.hidden{display:none!important}.small{font-size:.85rem}
</style></head>
<body><main>
<div class="eyebrow">Private control panel</div><h1>Elyndor Admin</h1><p>Update the public website without editing code. Only someone with the admin password can save changes.</p>
<section id="login" class="panel"><h2>Sign in</h2><form id="loginForm"><label for="password">Admin password</label><input id="password" type="password" autocomplete="current-password" required minlength="12"><button type="submit">Sign in</button></form><p id="loginMessage" class="message" role="status"></p></section>
<section id="editor" class="panel hidden"><div class="row"><div><h2>Website content</h2><p class="small">Changes are published to the public website when you save.</p></div><div style="text-align:right"><button id="logout" class="secondary" type="button">Sign out</button></div></div>
<form id="contentForm">
<label for="headline">Homepage headline</label><input id="headline" maxlength="120" required>
<label for="announcement">Announcement</label><textarea id="announcement" maxlength="1000" required></textarea>
<label for="status">Current development phase</label><input id="status" maxlength="120" required>
<h3>Development updates</h3>
<label for="u1title">Update 1 title</label><input id="u1title" maxlength="120" required>
<label for="u1body">Update 1 details</label><textarea id="u1body" maxlength="1000" required></textarea>
<label for="u1status">Update 1 status</label><input id="u1status" maxlength="40" required>
<label for="u2title">Update 2 title</label><input id="u2title" maxlength="120" required>
<label for="u2body">Update 2 details</label><textarea id="u2body" maxlength="1000" required></textarea>
<label for="u2status">Update 2 status</label><input id="u2status" maxlength="40" required>
<button type="submit">Save and publish</button></form><p id="saveMessage" class="message" role="status"></p>
<hr style="border:0;border-top:1px solid var(--line);margin:28px 0">
<h2>Permanent development log</h2><p class="small">Each published entry is stored separately. Publishing another entry will not overwrite older logs.</p>
<form id="logForm"><input id="logId" type="hidden"><label for="logTitle">Log title</label><input id="logTitle" maxlength="140" required placeholder="e.g. Chunk-edge meshing fixed"><label for="logCategory">Category</label><select id="logCategory" style="display:block;width:100%;padding:12px;border:1px solid #515746;border-radius:5px;background:#10130f;color:var(--ink);font:inherit"><option>Development</option><option>Features</option><option>Bug Fixes</option><option>Performance</option><option>Announcement</option></select><label for="logBody">Details</label><textarea id="logBody" maxlength="5000" required placeholder="What changed, what works, and what is still being worked on?"></textarea><button type="submit" id="logSubmit">Publish log entry</button><button type="button" class="secondary hidden" id="cancelEdit">Cancel edit</button></form><p id="logMessage" class="message" role="status"></p><h3>Published entries</h3><div id="adminLogs"><p class="small">Loading entries…</p></div></section>
<p class="small">Admin URL: <code>/admin</code>. Session expires after 8 hours. Keep the password private.</p>
</main>
<script>
const $ = id => document.getElementById(id);
async function api(path, options={}) {
  const response = await fetch(path, {credentials:"same-origin", ...options});
  const data = await response.json().catch(()=>({error:"Unexpected server response"}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function showEditor(show){$("login").classList.toggle("hidden",show);$("editor").classList.toggle("hidden",!show);}
async function loadContent(){
  const data=await api("/api/admin/content");
  $("headline").value=data.headline||"";$("announcement").value=data.announcement||"";$("status").value=data.status||"";
  for(let i=0;i<2;i++){const u=data.updates?.[i]||{title:"",body:"",status:""};const n=i+1;$("u"+n+"title").value=u.title;$("u"+n+"body").value=u.body;$("u"+n+"status").value=u.status;}
  showEditor(true);
  await refreshLogs().catch(err => { $("adminLogs").textContent = err.message; });
}
function resetLogForm(){ $("logId").value=""; $("logTitle").value=""; $("logCategory").value="Development"; $("logBody").value=""; $("logSubmit").textContent="Publish log entry"; $("cancelEdit").classList.add("hidden"); }
async function refreshLogs(){ const data=await api("/api/admin/changelog"); const host=$("adminLogs"); if(!data.entries.length){host.innerHTML='<p class="small">No permanent logs published yet.</p>';return;} host.innerHTML=data.entries.map(e=>'<article style="border:1px solid var(--line);border-radius:6px;padding:14px;margin:10px 0"><div class="small">'+esc(new Date(e.createdAt).toLocaleString())+' · '+esc(e.category)+'</div><strong>'+esc(e.title)+'</strong><p class="small" style="white-space:pre-wrap">'+esc(e.body)+'</p><button type="button" class="secondary" data-edit="'+esc(e.id)+'">Edit</button><button type="button" class="secondary" data-delete="'+esc(e.id)+'">Delete</button></article>').join(""); }
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
$("logForm").addEventListener("submit",async e=>{e.preventDefault();$("logMessage").textContent="Saving log…";const id=$("logId").value;const payload={title:$("logTitle").value,category:$("logCategory").value,body:$("logBody").value};try{await api(id?"/api/admin/changelog/"+encodeURIComponent(id):"/api/admin/changelog",{method:id?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});resetLogForm();await refreshLogs();$("logMessage").textContent="Published. The public archive is updated.";}catch(err){$("logMessage").textContent=err.message;}});
$("cancelEdit").addEventListener("click",resetLogForm);
$("adminLogs").addEventListener("click",async e=>{const edit=e.target.closest("[data-edit]");const del=e.target.closest("[data-delete]");try{if(edit){const d=await api("/api/admin/changelog");const entry=d.entries.find(x=>x.id===edit.dataset.edit);if(!entry)return;$("logId").value=entry.id;$("logTitle").value=entry.title;$("logCategory").value=entry.category;$("logBody").value=entry.body;$("logSubmit").textContent="Save changes";$("cancelEdit").classList.remove("hidden");window.scrollTo({top:document.getElementById("logForm").getBoundingClientRect().top+window.scrollY-20,behavior:"smooth"});}else if(del&&confirm("Delete this development log permanently?")){await api("/api/admin/changelog/"+encodeURIComponent(del.dataset.delete),{method:"DELETE"});await refreshLogs();$("logMessage").textContent="Log entry deleted.";}}catch(err){$("logMessage").textContent=err.message;}});
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();$("loginMessage").textContent="Signing in…";try{await api("/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:$("password").value})});$("password").value="";await loadContent();$("loginMessage").textContent="";}catch(err){$("loginMessage").textContent=err.message;}});
$("contentForm").addEventListener("submit",async e=>{e.preventDefault();$("saveMessage").textContent="Saving…";const content={headline:$("headline").value,announcement:$("announcement").value,status:$("status").value,updatedAt:new Date().toISOString(),updates:[1,2].map(n=>({title:$("u"+n+"title").value,body:$("u"+n+"body").value,status:$("u"+n+"status").value}))};try{await api("/api/admin/content",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(content)});$("saveMessage").textContent="Saved. Public site content is updated.";}catch(err){$("saveMessage").textContent=err.message;}});
$("logout").addEventListener("click",async()=>{try{await api("/api/admin/logout",{method:"POST"});}finally{showEditor(false);}});
(async()=>{try{await loadContent();}catch{showEditor(false);}})();
</script></body></html>`;

function adminPage() {
  return new Response(ADMIN_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    }
  });
}

async function parseBody(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error("Expected JSON body");
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 20000) throw new Error("Request is too large");
  return request.json();
}

function safeText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function validateContent(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid content");
  const updates = Array.isArray(input.updates) ? input.updates.slice(0, 2) : [];
  const clean = {
    headline: safeText(input.headline, 120),
    announcement: safeText(input.announcement, 1000),
    status: safeText(input.status, 120),
    updatedAt: new Date().toISOString(),
    updates: updates.map(item => ({
      title: safeText(item?.title, 120),
      body: safeText(item?.body, 1000),
      status: safeText(item?.status, 40)
    }))
  };
  if (!clean.headline || !clean.announcement || !clean.status || clean.updates.length !== 2 ||
      clean.updates.some(item => !item.title || !item.body || !item.status)) {
    throw new Error("Fill in all fields before saving");
  }
  return clean;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (url.pathname === "/api/health" && method === "GET") {
      return json({ ok: true, project: "Elyndor", service: "Cloudflare Worker" });
    }

    if (url.pathname === "/api/progress" && method === "GET") {
      return json(await readContent(env));
    }

    if (url.pathname === "/api/changelog" && method === "GET") {
      return json({ entries: await listChangelog(env) });
    }

    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      if (method !== "GET") return new Response("Method not allowed", { status: 405 });
      return adminPage();
    }

    if (url.pathname.startsWith("/api/admin/")) {
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.SITE_CONTENT) {
        return json({ error: "Admin is not configured. Set ADMIN_PASSWORD, SESSION_SECRET, and the SITE_CONTENT KV binding." }, 503);
      }

      if (url.pathname === "/api/admin/login" && method === "POST") {
        try {
          const body = await parseBody(request);
          if (typeof body.password !== "string" || body.password.length > 256) return json({ error: "Invalid credentials" }, 401);
          const expected = new TextEncoder().encode(env.ADMIN_PASSWORD);
          const supplied = new TextEncoder().encode(body.password);
          let diff = expected.length ^ supplied.length;
          const max = Math.max(expected.length, supplied.length);
          for (let i = 0; i < max; i++) diff |= (expected[i] || 0) ^ (supplied[i] || 0);
          if (diff !== 0) return json({ error: "Invalid credentials" }, 401);
          const session = await createSession(env.SESSION_SECRET);
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
              "set-cookie": cookieHeader(session, SESSION_SECONDS),
              "x-content-type-options": "nosniff"
            }
          });
        } catch {
          return json({ error: "Could not sign in" }, 400);
        }
      }

      if (url.pathname === "/api/admin/logout" && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "set-cookie": cookieHeader("", 0),
            "x-content-type-options": "nosniff"
          }
        });
      }

      if (!(await validSession(request, env.SESSION_SECRET))) {
        return json({ error: "Sign in required" }, 401);
      }

      if (url.pathname === "/api/admin/content" && method === "GET") {
        return json(await readContent(env));
      }

      if (url.pathname === "/api/admin/content" && method === "PUT") {
        try {
          const body = await parseBody(request);
          const clean = validateContent(body);
          await env.SITE_CONTENT.put(CONTENT_KEY, JSON.stringify(clean));
          return json({ ok: true, updatedAt: clean.updatedAt });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Could not save content" }, 400);
        }
      }

      if (url.pathname === "/api/admin/changelog" && method === "GET") {
        return json({ entries: await listChangelog(env) });
      }
      if (url.pathname === "/api/admin/changelog" && method === "POST") {
        try {
          const entry = validateLog(await parseBody(request));
          entry.createdAt = new Date().toISOString();
          await env.SITE_CONTENT.put(LOG_PREFIX + entry.id, JSON.stringify(entry));
          return json({ ok: true, entry }, 201);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Could not publish log" }, 400);
        }
      }
      const logMatch = url.pathname.match(/^\/api\/admin\/changelog\/([a-zA-Z0-9_-]{1,100})$/);
      if (logMatch && method === "PUT") {
        try {
          const key = LOG_PREFIX + logMatch[1];
          const existing = await env.SITE_CONTENT.get(key, "json");
          if (!existing) return json({ error: "Log entry not found" }, 404);
          const entry = validateLog({ ...await parseBody(request), id: logMatch[1], createdAt: existing.createdAt });
          await env.SITE_CONTENT.put(key, JSON.stringify(entry));
          return json({ ok: true, entry });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Could not update log" }, 400);
        }
      }
      if (logMatch && method === "DELETE") {
        await env.SITE_CONTENT.delete(LOG_PREFIX + logMatch[1]);
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
