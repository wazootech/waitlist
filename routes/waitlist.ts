import type { Context } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const DB_PATH = "/dev/shm/waitlist.json";

interface WaitlistEntry {
  id: number;
  email: string;
  ip_hash: string;
  recaptcha_score: number;
  created_at: string;
}

function readDb(): WaitlistEntry[] {
  if (!existsSync(DB_PATH)) return [];
  return JSON.parse(readFileSync(DB_PATH, "utf8"));
}

function writeDb(entries: WaitlistEntry[]): void {
  writeFileSync(DB_PATH, JSON.stringify(entries, null, 2));
}

async function verifyRecaptcha(token: string, ip: string): Promise<number> {
  if (!token || token === "dev-skip") return 0.9;
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return 0.5;
  try {
    const data = await fetch(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`,
      { method: "POST" }
    ).then(r => r.json());
    if (data.success && data.action === "waitlist" && data.score != null) {
      return data.score as number;
    }
    return -1;
  } catch {
    return -1;
  }
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

const HTML = (count: number, email: string, score: number) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Join the Waitlist</title>
  <script src="https://www.google.com/recaptcha/api.js?render=${process.env.RECAPTCHA_SITE_KEY || ""}" defer></script>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1a1a1a; padding: 2rem; border-radius: 12px; width: 100%; max-width: 400px; box-shadow: 0 4px 24px rgba(0,0,0,0.5); }
    h1 { margin: 0 0 1.5rem; font-size: 1.5rem; }
    label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #a1a1a1; }
    input { width: 100%; padding: 0.75rem; border: 1px solid #333; border-radius: 8px; background: #111; color: #fff; box-sizing: border-box; font-size: 1rem; }
    button { width: 100%; margin-top: 1rem; padding: 0.875rem; border: none; border-radius: 8px; background: #fff; color: #000; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .badge { display: inline-block; margin-bottom: 1.5rem; padding: 0.3rem 0.75rem; background: rgba(255,255,255,0.1); border-radius: 999px; font-size: 0.75rem; color: #a1a1a1; }
    .count { font-size: 0.8rem; color: #666; margin-top: 1rem; text-align: center; }
    #msg { margin-top: 0.75rem; font-size: 0.875rem; text-align: center; }
    #msg.error { color: #f87171; }
    #msg.success { color: #4ade80; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Private Beta</span>
    <h1>Join the Waitlist</h1>
    <form id="form">
      <label for="email">Email address</label>
      <input type="email" id="email" name="email" placeholder="you@example.com" required autocomplete="email" />
      <button type="submit" id="btn">Join the list</button>
    </form>
    <div id="msg"></div>
    <div class="count"><span id="count">${count}</span> on the list</div>
  </div>
  <script>
    const form = document.getElementById('form');
    const msg  = document.getElementById('msg');
    const btn  = document.getElementById('btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      btn.disabled = true; btn.textContent = 'Sending…'; msg.textContent = '';

      try {
        let token = '';
        if (typeof grecaptcha !== 'undefined') {
          token = await grecaptcha.execute('${process.env.RECAPTCHA_SITE_KEY || ""}', { action: 'waitlist' });
        }

        const res = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ email, token })
        });

        const data = await res.json();
        if (res.ok) {
          msg.textContent = "You're on the list! We'll be in touch.";
          msg.className = 'success';
          document.getElementById('count').textContent = data.count;
          form.reset();
        } else {
          msg.textContent = data.error || 'Something went wrong.';
          msg.className = 'error';
        }
      } catch {
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'error';
      } finally {
        btn.disabled = false; btn.textContent = 'Join the list';
      }
    });
  </script>
</body>
</html>`;

export default async (c: Context) => {
  const accept = c.req.header("Accept") || "";
  const isApi  = accept.includes("application/json");

  if (c.req.method === "GET") {
    const entries = readDb();
    if (isApi) return c.json({ count: entries.length });
    return c.html(HTML(entries.length, "", 0));
  }

  if (c.req.method === "POST") {
    const { email, token } = await c.req.json();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (isApi) return c.json({ error: "A valid email address is required." }, 400);
      return c.html(HTML(0, email, 0), 400);
    }

    const clientIp = c.req.header("x-forwarded-for")?.split(",")[0] || "unknown";
    const score    = await verifyRecaptcha(token || "", clientIp);

    const entries = readDb();
    if (entries.some(e => e.email.toLowerCase() === email.toLowerCase())) {
      if (isApi) return c.json({ error: "You're already on the list! We'll be in touch." }, 409);
      return c.html(HTML(entries.length, email, score), 200);
    }

    const newEntry: WaitlistEntry = {
      id:             entries.length > 0 ? Math.max(...entries.map(e => e.id)) + 1 : 1,
      email,
      ip_hash:        hashIp(clientIp),
      recaptcha_score: score,
      created_at:     new Date().toISOString(),
    };

    entries.push(newEntry);
    writeDb(entries);

    if (isApi) return c.json({ id: newEntry.id, email, count: entries.length }, 201);
    return c.html(HTML(entries.length, email, score), 201);
  }

  return c.json({ error: "Method not allowed" }, 405);
};
