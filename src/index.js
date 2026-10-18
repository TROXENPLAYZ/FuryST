const COOKIE_NAME = "elyndor_admin";
const SESSION_SECONDS = 60 * 60 * 8;
const CONTENT_KEY = "site-content-v1";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
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
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(value)
    )
  );
}

async function createSession(secret) {
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
        nonce: base64url(crypto.getRandomValues(new Uint8Array(16)))
      })
    )
  );

  const signature = base64url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

async function validSession(request, secret) {
  if (!secret) return false;

  const parts = cookieValue(request, COOKIE_NAME).split(".");
  if (parts.length !== 2) return false;

  try {
    const expected = await hmac(secret, parts[0]);
    const supplied = fromBase64url(parts[1]);

    if (expected.length !== supplied.length) return false;

    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected[i] ^ supplied[i];
    }

    if (diff !== 0) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64url(parts[0]))
    );

    return (
      Number.isFinite(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

function cookieHeader(value, maxAge) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function readContent(env) {
  const stored = await env.SITE_CONTENT.get(CONTENT_KEY, "json");

  if (stored && typeof stored === "object") {
    return stored;
  }

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

const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>FuryST Admin</title>
<style>
:root{color-scheme:dark;--bg:#111410;--panel:#191d17;--ink:#eee8d8;--muted:#b6b5a7;--gold:#d9bd7b;--line:#3b4234}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{width:min(860px,calc(100% - 32px));margin:48px auto}
.eyebrow{color:var(--gold);letter-spacing:.16em;text-transform:uppercase;font-size:.75rem;font-weight:700}
h1{font:500 clamp(2rem,6vw,3.6rem)/1.1 Georgia,serif;margin:10px 0}
p{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:22px;margin:20px 0}
label{display:block;font-weight:650;margin:16px 0 6px}
input,textarea{display:block;width:100%;padding:12px;border:1px solid #515746;border-radius:5px;background:#10130f;color:var(--ink);font:inherit}
textarea{min-height:110px;resize:vertical}
button{border:1px solid var(--gold);background:var(--gold);color:#171811;font:700 1rem system-ui;padding:12px 18px;border-radius:5px;cursor:pointer;margin-top:16px}
button.secondary{background:transparent;color:var(--ink);border-color:var(--line);margin-left:8px}
.row{display:flex;gap:12px;flex-wrap:wrap}
.row>*{flex:1;min-width:180px}
.message{min-height:1.5em;color:var(--gold)}
.hidden{display:none!important}
.small{font-size:.85rem}
</style>
</head>
<body>
<main>
<div class="eyebrow">Private control panel</div>
<h1>FuryST Admin</h1>
<p>Update the public website without editing code.</p>

<section id="login" class="panel">
<h2>Sign in</h2>
<form id="loginForm">
<label for="password">Admin password</label>
<input id="password" type="password" autocomplete="current-password" required minlength="12">
<button type="submit">Sign in</button>
</form>
<p id="loginMessage" class="message" role="status"></p>
</section>

<section id="editor" class="panel hidden">
<div class="row">
<div><h2>Website content</h2><p class="small">Changes appear on the public site after saving.</p></div>
<div style="text-align:right"><button id="logout" class="secondary" type="button">Sign out</button></div>
</div>

<form id="contentForm">
<label for="headline">Homepage headline</label>
<input id="headline" maxlength="120" required>

<label for="announcement">Announcement</label>
<textarea id="announcement" maxlength="1000" required></textarea>

<label for="status">Current development phase</label>
<input id="status" maxlength="120" required>

<h3>Development update 1</h3>
<label for="u1title">Title</label>
<input id="u1title" maxlength="120" required>
<label for="u1body">Details</label>
<textarea id="u1body" maxlength="1000" required></textarea>
<label for="u1status">Status</label>
<input id="u1status" maxlength="40" required>

<h3>Development update 2</h3>
<label for="u2title">Title</label>
<input id="u2title" maxlength="120" required>
<label for="u2body">Details</label>
<textarea id="u2body" maxlength="1000" required></textarea>
<label for="u2status">Status</label>
<input id="u2status" maxlength="40" required>

<button type="submit">Save and publish</button>
</form>
<p id="saveMessage" class="message" role="status"></p>
</section>

<p class="small">Admin URL: /admin. Session expires after eight hours.</p>
</main>

<script>
const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options
  });

  const data = await response.json().catch(() => ({
    error: "Unexpected server response"
  }));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function showEditor(show) {
  $("login").classList.toggle("hidden", show);
  $("editor").classList.toggle("hidden", !show);
}

async function loadContent() {
  const data = await api("/api/admin/content");

  $("headline").value = data.headline || "";
  $("announcement").value = data.announcement || "";
  $("status").value = data.status || "";

  for (let i = 0; i < 2; i++) {
    const update = data.updates?.[i] || {
      title: "",
      body: "",
      status: ""
    };

    const n = i + 1;
    $("u" + n + "title").value = update.title;
    $("u" + n + "body").value = update.body;
    $("u" + n + "status").value = update.status;
  }

  showEditor(true);
}

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("loginMessage").textContent = "Signing in…";

  try {
    await api("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: $("password").value
      })
    });

    $("password").value = "";
    await loadContent();
    $("loginMessage").textContent = "";
  } catch (error) {
    $("loginMessage").textContent = error.message;
  }
});

$("contentForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("saveMessage").textContent = "Saving…";

  const content = {
    headline: $("headline").value,
    announcement: $("announcement").value,
    status: $("status").value,
    updates: [1, 2].map(n => ({
      title: $("u" + n + "title").value,
      body: $("u" + n + "body").value,
      status: $("u" + n + "status").value
    }))
  };

  try {
    await api("/api/admin/content", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(content)
    });

    $("saveMessage").textContent =
      "Saved! Your public content has been updated.";
  } catch (error) {
    $("saveMessage").textContent = error.message;
  }
});

$("logout").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } finally {
    showEditor(false);
  }
});

(async () => {
  try {
    await loadContent();
  } catch {
    showEditor(false);
  }
})();
</script>
</body>
</html>`;

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

  if (!type.includes("application/json")) {
    throw new Error("Expected JSON body");
  }

  const length = Number(request.headers.get("content-length") || 0);

  if (length > 20000) {
    throw new Error("Request is too large");
  }

  return request.json();
}

function safeText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function validateContent(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid content");
  }

  const updates = Array.isArray(input.updates)
    ? input.updates.slice(0, 2)
    : [];

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

  if (
    !clean.headline ||
    !clean.announcement ||
    !clean.status ||
    clean.updates.length !== 2 ||
    clean.updates.some(item => !item.title || !item.body || !item.status)
  ) {
    throw new Error("Fill in all fields before saving");
  }

  return clean;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (url.pathname === "/api/health" && method === "GET") {
      return json({
        ok: true,
        project: "FuryST",
        service: "Cloudflare Worker"
      });
    }

    if (url.pathname === "/api/progress" && method === "GET") {
      return json(await readContent(env));
    }

    if (
      (url.pathname === "/admin" || url.pathname === "/admin/") &&
      method === "GET"
    ) {
      return adminPage();
    }

    if (url.pathname.startsWith("/api/admin/")) {
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.SITE_CONTENT) {
        return json({
          error: "Admin is not configured. Set ADMIN_PASSWORD, SESSION_SECRET, and the SITE_CONTENT KV binding."
        }, 503);
      }

      if (url.pathname === "/api/admin/login" && method === "POST") {
        try {
          const body = await parseBody(request);

          if (
            typeof body.password !== "string" ||
            body.password.length > 256
          ) {
            return json({ error: "Invalid credentials" }, 401);
          }

          const expected = new TextEncoder().encode(env.ADMIN_PASSWORD);
          const supplied = new TextEncoder().encode(body.password);

          let diff = expected.length ^ supplied.length;
          const max = Math.max(expected.length, supplied.length);

          for (let i = 0; i < max; i++) {
            diff |= (expected[i] || 0) ^ (supplied[i] || 0);
          }

          if (diff !== 0) {
            return json({ error: "Invalid credentials" }, 401);
          }

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

      if (
        url.pathname === "/api/admin/logout" &&
        method === "POST"
      ) {
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

      if (
        url.pathname === "/api/admin/content" &&
        method === "GET"
      ) {
        return json(await readContent(env));
      }

      if (
        url.pathname === "/api/admin/content" &&
        method === "PUT"
      ) {
        try {
          const body = await parseBody(request);
          const clean = validateContent(body);

          await env.SITE_CONTENT.put(
            CONTENT_KEY,
            JSON.stringify(clean)
          );

          return json({
            ok: true,
            updatedAt: clean.updatedAt
          });
        } catch (error) {
          return json({
            error: error instanceof Error
              ? error.message
              : "Could not save content"
          }, 400);
        }
      }

      return json({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
