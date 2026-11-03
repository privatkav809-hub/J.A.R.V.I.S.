import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const CASES_FILE = path.join(DATA_DIR, "cases.json");
const LAWS_FILE = path.join(DATA_DIR, "laws.json");

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 150);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 8 }
});

const lawUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  for (const file of [CASES_FILE, LAWS_FILE]) {
    try { await fs.access(file); }
    catch { await fs.writeFile(file, "[]", "utf8"); }
  }
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return []; }
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

function requireAI(res) {
  if (!OPENROUTER_API_KEY) {
    res.status(503).json({
      error: "ИИ не подключён: на Render отсутствует OPENROUTER_API_KEY. Добавьте ключ в Environment и выполните Deploy.",
      demo: true
    });
    return false;
  }
  return true;
}

async function askJarvis(content) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://j-a-r-v-i-s-2-eiqg.onrender.com",
      "X-Title": "J.A.R.V.I.S. FBI CASE ANALYST"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "user", content }],
      temperature: 0.2,
      max_tokens: 7000
    }),
    signal: AbortSignal.timeout(120000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenRouter HTTP ${response.status}`);
  }

  const result = data?.choices?.[0]?.message?.content;
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result.filter(item => item.type === "text").map(item => item.text).join("\n");
  }
  throw new Error("OpenRouter не вернул текстовый ответ.");
}

function bbEscape(value = "") {
  return String(value).replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
}

function makeBBCode(title, body) {
  return `[center][b][size=16]ФЕДЕРАЛЬНОЕ БЮРО РАССЛЕДОВАНИЙ[/size][/b]
Центральный офис г. Сан-Фиерро, Квинс 11[/center]
[hr]
[center][b][size=14]${bbEscape(title || "АНАЛИТИЧЕСКОЕ ЗАКЛЮЧЕНИЕ")}[/size][/b][/center]

${body || "Требуется заполнить содержание документа."}

[hr]
[right]Уполномоченный сотрудник: [указать]
Подпись: [указать][/right]`;
}

function extractText(html) {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, 100000);
}

function assertPublicHttpUrl(raw) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Разрешены только HTTP/HTTPS ссылки.");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" ||
      host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("172.16.")) {
    throw new Error("Локальные адреса запрещены.");
  }
  return u;
}

function saveLaw({ title, content, sourceUrl = "", status = "Добавлено вручную" }) {
  return {
    id: crypto.randomUUID(),
    title: String(title || "Документ без названия").trim().slice(0, 180),
    sourceUrl,
    content: String(content).trim().slice(0, 100000),
    addedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    status
  };
}

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args);
    let err = "";
    p.stderr.on("data", d => { err += d.toString(); });
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve() : reject(new Error(err || `${command} завершился с кодом ${code}`)));
  });
}

async function processVideo(buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-"));
  const input = path.join(dir, "input.mp4");
  const framesDir = path.join(dir, "frames");
  await fs.writeFile(input, buffer);
  await fs.mkdir(framesDir);
  try {
    await run("ffmpeg", ["-i", input, "-vf", "fps=1/10,scale=960:-1", "-frames:v", "8", path.join(framesDir, "frame-%02d.jpg"), "-y"]);
    const names = (await fs.readdir(framesDir)).sort();
    const frames = [];
    for (let i = 0; i < names.length; i++) {
      const data = await fs.readFile(path.join(framesDir, names[i]));
      frames.push({ timestamp: `${i * 10}s`, dataUrl: `data:image/jpeg;base64,${data.toString("base64")}` });
    }
    return { frames, transcript: "", cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error(`Не удалось обработать видео. Проверьте FFmpeg. ${e.message}`);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true, assistant: "J.A.R.V.I.S.", aiConnected: Boolean(OPENROUTER_API_KEY),
    provider: "OpenRouter", model: OPENROUTER_MODEL, videoProcessing: true, transcription: false
  });
});

app.get("/api/cases", async (_req, res) => res.json(await readJson(CASES_FILE)));
app.get("/api/laws", async (_req, res) => res.json(await readJson(LAWS_FILE)));

app.post("/api/laws/manual", lawUpload.single("file"), async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    let content = String(req.body.content || "").trim();
    if (req.file) {
      const filename = req.file.originalname || "document.txt";
      if (!filename.toLowerCase().endsWith(".txt") && req.file.mimetype !== "text/plain") {
        return res.status(415).json({ error: "Загрузите текстовый файл .txt." });
      }
      content = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
    }
    if (content.length < 20) return res.status(400).json({ error: "Добавьте текст документа (минимум 20 символов)." });
    if (content.length > 100000) return res.status(413).json({ error: "Документ слишком большой. Максимум 100 000 символов." });
    const laws = await readJson(LAWS_FILE);
    const item = saveLaw({ title, content });
    laws.unshift(item);
    await writeJson(LAWS_FILE, laws);
    res.json({ ok: true, law: { ...item, content: undefined }, extractedCharacters: content.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/laws/import", async (req, res) => {
  try {
    const url = assertPublicHttpUrl(req.body.url || "");
    const response = await fetch(url, {
      redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "JARVIS-ARZ-RP-Law-Reader/1.0" }
    });
    if (!response.ok) return res.status(400).json({ error: `Источник ответил HTTP ${response.status}` });
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("text/plain")) {
      return res.status(415).json({ error: "Поддерживаются HTML и TXT." });
    }
    const raw = await response.text();
    const content = type.includes("text/html") ? extractText(raw) : raw.slice(0, 100000);
    if (content.length < 80) return res.status(400).json({ error: "На странице недостаточно текста." });
    const laws = await readJson(LAWS_FILE);
    const item = saveLaw({
      title: req.body.title || new URL(response.url).hostname,
      content, sourceUrl: response.url, status: "Требует проверки актуальности"
    });
    laws.unshift(item);
    await writeJson(LAWS_FILE, laws);
    res.json({ ok: true, law: { ...item, content: undefined }, extractedCharacters: content.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/laws/:id", async (req, res) => {
  const laws = await readJson(LAWS_FILE);
  await writeJson(LAWS_FILE, laws.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

app.post("/api/analyze", upload.array("videos", 8), async (req, res) => {
  if (!requireAI(res)) return;
  const caseText = String(req.body.caseText || "").trim();
  if (caseText.length < 30) return res.status(400).json({ error: "Добавьте полный текст CASEFILE." });

  const laws = await readJson(LAWS_FILE);
  const cleanLaws = laws.map(l => `ДОКУМЕНТ: ${l.title}
ИСТОЧНИК: ${l.sourceUrl || "Добавлено вручную"}
СТАТУС: ${l.status}
ТЕКСТ:
${l.content}`).join("\n\n---\n\n").slice(0, 90000);

  const videoResults = [];
  const cleanups = [];
  try {
    for (const file of (req.files || [])) {
      if (!file.mimetype.startsWith("video/")) continue;
      const result = await processVideo(file.buffer);
      cleanups.push(result.cleanup);
      videoResults.push({ name: file.originalname, transcript: result.transcript, frames: result.frames });
    }

    const content = [{
      type: "text",
      text: `
Ты — J.A.R.V.I.S., аналитическое ядро FBI CASE ANALYST для игрового RP-проекта Arizona RolePlay.
Отвечай исключительно на русском языке.
Это игровое делопроизводство, не реальная юридическая консультация.
Работай независимо: не поддерживай автоматически заявителя или сотрудника.
Не выдумывай факты, статьи, даты, имена, содержание видео или полномочия.
Используй только предоставленные нормативные документы. Если их нет или источник не подтверждён, прямо укажи это.
Отличай отсутствие доказательств от доказанного отсутствия события.
Все выводы привязывай к цитатам, фрагментам CASEFILE или временным отметкам кадров.
Учитывай, что видеокадры выборочные и могут не показывать всё происходящее.
Не выноси обязательное решение вместо уполномоченного человека: сформируй рекомендацию и объясни её.
СТРУКТУРА ЗАКЛЮЧЕНИЯ:
1. Краткая карточка дела.
2. Хронология.
3. Установленные обстоятельства.
4. Анализ каждого доказательства.
5. Сопоставление текста и видео.
6. Противоречия и пробелы.
7. Проверка применимых норм с точными названиями источников.
8. Рекомендуемое процессуальное решение и обоснование.
9. Что необходимо запросить дополнительно.
10. Проект документа в BBCode.
11. Ограничения анализа.
Если поле неизвестно, укажи «Не установлено». Не заполняй пробелы догадками.
ТЕКСТ CASEFILE:
${caseText}
НОРМАТИВНАЯ БАЗА:
${cleanLaws || "Нормативные документы не добавлены."}
ВИДЕОМАТЕРИАЛЫ:
${videoResults.map(v => `Файл: ${v.name}
Распознанная речь: Не получена.
Доступные кадры: ${v.frames.length}.
Временные отметки: ${v.frames.map(f => f.timestamp).join(", ")}`).join("\n\n") || "Видео не приложено."}
`
    }];

    for (const v of videoResults) {
      for (const frame of v.frames) {
        content.push({ type: "text", text: `Кадр из файла "${v.name}", отметка ${frame.timestamp}. Это выборочный кадр, не полная запись.` });
        content.push({ type: "image_url", image_url: { url: frame.dataUrl } });
      }
    }

    const analysis = await askJarvis(content);
    const record = {
      id: crypto.randomUUID(),
      number: `FBI-${new Date().getFullYear()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      createdAt: new Date().toISOString(), status: "Ожидает утверждения", caseText,
      videoNames: (req.files || []).map(f => f.originalname), analysis,
      bbcode: makeBBCode("АНАЛИТИЧЕСКОЕ ЗАКЛЮЧЕНИЕ", analysis)
    };
    const cases = await readJson(CASES_FILE);
    cases.unshift(record);
    await writeJson(CASES_FILE, cases);
    res.json(record);
  } catch (e) {
    res.status(500).json({ error: `Ошибка анализа: ${e.message}` });
  } finally {
    for (const cleanup of cleanups) await cleanup().catch(() => {});
  }
});

app.patch("/api/cases/:id", async (req, res) => {
  const cases = await readJson(CASES_FILE);
  const i = cases.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "Дело не найдено." });
  cases[i] = { ...cases[i], ...req.body, id: cases[i].id, updatedAt: new Date().toISOString() };
  await writeJson(CASES_FILE, cases);
  res.json(cases[i]);
});

app.delete("/api/cases/:id", async (req, res) => {
  const cases = await readJson(CASES_FILE);
  await writeJson(CASES_FILE, cases.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

await ensureStore();
app.listen(PORT, () => console.log(`J.A.R.V.I.S. запущен на порту ${PORT}`));
