const $ = (id) => document.getElementById(id);
let cases = [], laws = [], currentRecord = null;
const views = ["home","review","archive","laws","settings"];

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3200);
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({ error: "Некорректный ответ сервера" }));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

function navigate(name) {
  views.forEach(v => $(v + "View").classList.toggle("active", v === name));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.go === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "archive") renderArchive();
  if (name === "laws") renderLaws();
}

document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.go)));

$("caseText").addEventListener("input", () => {
  $("charCount").textContent = $("caseText").value.length.toLocaleString("ru-RU") + " символов";
  localStorage.setItem("jarvis-case-draft", $("caseText").value);
});
$("caseText").value = localStorage.getItem("jarvis-case-draft") || "";
$("charCount").textContent = $("caseText").value.length.toLocaleString("ru-RU") + " символов";

$("videoFiles").addEventListener("change", () => {
  $("videoList").innerHTML = "";
  [...$("videoFiles").files].forEach(f => {
    const el = document.createElement("div");
    el.className = "file-chip";
    el.textContent = `${f.name} · ${(f.size / 1024 / 1024).toFixed(1)} МБ`;
    $("videoList").append(el);
  });
});

$("manualLawContent").addEventListener("input", () => {
  $("lawCharCount").textContent = $("manualLawContent").value.length.toLocaleString("ru-RU") + " символов";
});

$("lawTxtFile").addEventListener("change", async () => {
  const file = $("lawTxtFile").files[0];
  $("lawFileName").textContent = file ? `Выбран файл: ${file.name} · ${(file.size / 1024).toFixed(1)} КБ` : "";
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast("TXT-файл больше 2 МБ.");
    $("lawTxtFile").value = "";
    $("lawFileName").textContent = "";
    return;
  }
  try {
    const text = await file.text();
    $("manualLawContent").value = text;
    $("lawCharCount").textContent = text.length.toLocaleString("ru-RU") + " символов";
    if (!$("manualLawTitle").value.trim()) $("manualLawTitle").value = file.name.replace(/\.txt$/i, "");
  } catch {
    toast("Не удалось прочитать TXT-файл.");
  }
});

async function refresh() {
  try {
    const health = await api("/api/health");
    $("statusDot").className = health.aiConnected ? "ok" : "bad";
    $("statusText").textContent = health.aiConnected ? "ИИ подключён" : "ИИ не подключён";
    $("aiState").textContent = health.aiConnected ? "Подключено" : "Нет API-ключа";
    $("modelState").textContent = health.model;
  } catch (e) {
    $("statusText").textContent = "Сервер недоступен";
    $("statusDot").className = "bad";
  }
  try {
    cases = await api("/api/cases");
    laws = await api("/api/laws");
  } catch (e) { toast(e.message); }
  renderHome();
  renderArchive();
  renderLaws();
}

function renderStats() {
  $("totalCases").textContent = cases.length;
  $("pendingCases").textContent = cases.filter(c => c.status === "Ожидает утверждения").length;
  $("approvedCases").textContent = cases.filter(c => c.status === "Утверждено").length;
  $("archivedCases").textContent = cases.filter(c => c.status === "В архиве").length;
}

function itemHtml(c) {
  const div = document.createElement("div");
  div.className = "case-item";
  const left = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = c.number || "Дело без номера";
  const small = document.createElement("small");
  small.textContent = new Date(c.createdAt).toLocaleString("ru-RU") + " · " + (c.videoNames?.length || 0) + " видео";
  left.append(title, small);
  const badge = document.createElement("span");
  badge.className = "pill";
  badge.textContent = c.status || "На рассмотрении";
  div.append(left, badge);
  div.addEventListener("click", () => showRecord(c));
  return div;
}

function renderHome() {
  renderStats();
  $("recentCases").innerHTML = "";
  if (!cases.length) {
    $("recentCases").innerHTML = '<div class="empty">Пока нет рассмотренных дел.</div>';
    return;
  }
  cases.slice(0, 4).forEach(c => $("recentCases").append(itemHtml(c)));
}

function renderArchive() {
  const q = ($("archiveSearch").value || "").toLowerCase();
  $("archiveList").innerHTML = "";
  const filtered = cases.filter(c => (c.number + " " + c.caseText).toLowerCase().includes(q));
  if (!filtered.length) {
    $("archiveList").innerHTML = '<div class="empty">Дела не найдены.</div>';
    return;
  }
  filtered.forEach(c => $("archiveList").append(itemHtml(c)));
}
$("archiveSearch").addEventListener("input", renderArchive);

function renderLaws() {
  $("lawList").innerHTML = "";
  if (!laws.length) {
    $("lawList").innerHTML = '<div class="empty">Нормативные документы ещё не добавлены.</div>';
    return;
  }
  laws.forEach(l => {
    const el = document.createElement("div");
    el.className = "law-item";
    const title = document.createElement("b");
    title.textContent = l.title;
    const meta = document.createElement("small");
    meta.textContent = `${l.status} · ${(l.content?.length || 0).toLocaleString("ru-RU")} знаков`;
    meta.style.cssText = "display:block;color:var(--muted);font-size:10px;margin:6px 0";
    el.append(title, meta);
    if (l.sourceUrl) {
      const link = document.createElement("a");
      link.href = l.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Открыть источник";
      link.style.cssText = "color:var(--gold);font-size:10px";
      el.append(link);
    } else {
      const local = document.createElement("small");
      local.textContent = "Локально добавленный документ";
      local.style.cssText = "display:block;color:var(--muted);font-size:10px";
      el.append(local);
    }
    const del = document.createElement("button");
    del.className = "text-btn";
    del.textContent = "Удалить";
    del.style.marginLeft = "14px";
    del.onclick = async () => {
      if (!confirm("Удалить документ из нормативной базы?")) return;
      try { await api("/api/laws/" + l.id, { method: "DELETE" }); await refresh(); }
      catch (e) { toast(e.message); }
    };
    el.append(del);
    $("lawList").append(el);
  });
}

$("saveManualLawBtn").addEventListener("click", async () => {
  const title = $("manualLawTitle").value.trim();
  const content = $("manualLawContent").value.trim();
  const file = $("lawTxtFile").files[0];
  if (!content && !file) return toast("Вставьте текст или выберите TXT-файл.");
  const btn = $("saveManualLawBtn");
  btn.disabled = true;
  btn.textContent = "Сохраняю документ...";
  try {
    const form = new FormData();
    form.append("title", title || (file ? file.name.replace(/\.txt$/i, "") : "Документ без названия"));
    if (file) form.append("file", file);
    else form.append("content", content);
    const result = await api("/api/laws/manual", { method: "POST", body: form });
    toast(`Документ добавлен: ${result.extractedCharacters.toLocaleString("ru-RU")} знаков.`);
    $("manualLawTitle").value = "";
    $("manualLawContent").value = "";
    $("lawTxtFile").value = "";
    $("lawFileName").textContent = "";
    $("lawCharCount").textContent = "0 символов";
    await refresh();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Сохранить документ в базе";
  }
});

$("importLawBtn").addEventListener("click", async () => {
  const url = $("lawUrl").value.trim();
  if (!url) return toast("Вставьте ссылку на документ.");
  const btn = $("importLawBtn");
  btn.disabled = true;
  btn.textContent = "Изучаю источник...";
  try {
    const result = await api("/api/laws/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title: $("lawTitle").value.trim() })
    });
    toast(`Документ добавлен. Извлечено ${result.extractedCharacters} символов.`);
    $("lawUrl").value = "";
    $("lawTitle").value = "";
    await refresh();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Импортировать по ссылке";
  }
});

$("analyzeBtn").addEventListener("click", async () => {
  const text = $("caseText").value.trim();
  if (text.length < 30) return toast("Сначала вставьте текст CASEFILE.");
  const btn = $("analyzeBtn");
  btn.disabled = true;
  btn.textContent = "J.A.R.V.I.S. анализирует материалы...";
  $("analysisResult").classList.add("hidden");
  const form = new FormData();
  form.append("caseText", text);
  [...$("videoFiles").files].forEach(f => form.append("videos", f));
  try {
    const record = await api("/api/analyze", { method: "POST", body: form });
    currentRecord = record;
    cases.unshift(record);
    renderHome();
    renderResult(record);
    localStorage.removeItem("jarvis-case-draft");
    toast("Анализ завершён. Результат сохранён.");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Начать рассмотрение";
  }
});

function renderResult(r) {
  const el = $("analysisResult");
  el.classList.remove("hidden");
  el.innerHTML = "";
  const h = document.createElement("h3");
  h.textContent = `Заключение J.A.R.V.I.S. · ${r.number}`;
  const pre = document.createElement("div");
  pre.className = "analysis-text";
  pre.textContent = r.analysis;
  const actions = document.createElement("div");
  actions.className = "result-actions";
  const copy = document.createElement("button");
  copy.className = "primary";
  copy.textContent = "Скопировать BBCode";
  copy.onclick = () => navigator.clipboard.writeText(r.bbcode).then(() => toast("BBCode скопирован."));
  const plain = document.createElement("button");
  plain.className = "secondary";
  plain.textContent = "Скопировать заключение";
  plain.onclick = () => navigator.clipboard.writeText(r.analysis).then(() => toast("Текст скопирован."));
  const approve = document.createElement("button");
  approve.className = "secondary";
  approve.textContent = "Утвердить";
  approve.onclick = async () => {
    if (!confirm("Подтвердить решение и отметить документ как утверждённый?")) return;
    try {
      const updated = await api("/api/cases/" + r.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Утверждено" })
      });
      Object.assign(r, updated);
      await refresh();
      toast("Статус обновлён.");
    } catch (e) { toast(e.message); }
  };
  actions.append(copy, plain, approve);
  el.append(h, pre, actions);
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showRecord(r) {
  currentRecord = r;
  navigate("archive");
  renderResult(r);
  $("archiveList").after($("analysisResult"));
}

refresh();
