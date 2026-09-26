// Habit Tracker view v2. Configuration is supplied through dv.view(path, config).
const cleanFolder = input.dailyNotesFolder;
const dailyTemplatePath = input.dailyTemplatePath;
const habitCategories = input.categories;

if (!cleanFolder || !dailyTemplatePath || !Array.isArray(habitCategories)) {
  throw new Error("Habit tracker config requires dailyNotesFolder, dailyTemplatePath, and categories.");
}

const stateKey = "habitTrackerState_" + dv.current().file.path;
window[stateKey] ||= { selectedMonth: moment().format("YYYY-MM") };
const state = window[stateKey];
state.categoryVisibility ||= Object.fromEntries(habitCategories.map(c => [c.id, true]));
habitCategories.forEach(c => state.categoryVisibility[c.id] ??= true);

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const asArray = value => Array.isArray(value) ? value : value?.array instanceof Function ? value.array() : null;
// Dataview coerces values such as "15min" into Duration objects. Read configured
// habit fields from Obsidian's raw YAML cache so their declared types are preserved.
function field(page, key) {
  if (!page || !key) return undefined;
  const file = app.vault.getAbstractFileByPath(page.file.path);
  const frontmatter = file ? app.metadataCache.getFileCache(file)?.frontmatter : null;
  return frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, key) ? frontmatter[key] : page[key];
}
const present = value => {
  // A boolean is "present" only when explicitly true — blank (unset) and false are both not-present.
  if (typeof value === "boolean") return value === true;
  const list = asArray(value);
  return value !== undefined && value !== null && (list ? list.length > 0 : typeof value !== "string" || value.trim().length > 0);
};

function validationError(value, type) {
  if (value === undefined || value === null) return null;
  const list = asArray(value);
  if (type === "text") return typeof value === "string" ? null : "Expected text";
  if (type === "string-list") return list?.every(v => typeof v === "string") ? null : "Expected a list of text";
  if (type === "boolean") return typeof value === "boolean" ? null : "Expected true or false";
  if (type === "number") return typeof value === "number" && Number.isFinite(value) ? null : "Expected a number";
  if (type === "number-list") {
    if (typeof value === "number" && Number.isFinite(value)) return null;
    return list?.length && list.every(v => typeof v === "number" && Number.isFinite(v)) ? null : "Expected a number or list of numbers";
  }
  if (type === "time") return typeof value === "string" && TIME_RE.test(value) ? null : "Expected HH:mm";
  return `Unknown type: ${type}`;
}

function total(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const list = asArray(value);
  return list?.length && list.every(v => typeof v === "number" && Number.isFinite(v))
    ? list.reduce((sum, v) => sum + v, 0) : null;
}

function completion(page, item) {
  if (!page) return false;
  const status = field(page, item.key), goal = item.goalKey ? field(page, item.goalKey) : null;
  if (validationError(status, item.statusType) || (item.goalType && validationError(goal, item.goalType))) return false;
  if (item.checkRule === "sum-at-least") return typeof goal === "number" && goal > 0 && total(status) !== null && total(status) >= goal;
  if (item.checkRule === "text-contains-goal") return present(status) && (!present(goal) || String(status).includes(String(goal)));
  if (item.checkRule === "non-empty") return present(status);
  // Goal present but no checkRule: goal text is just a documented target, done means status is checked true.
  return item.goalKey ? status === true : false;
}

function format(value, listPrefix = true) {
  if (value === undefined || value === null) return "";
  const list = asArray(value);
  return list ? list.map(v => `${listPrefix ? "- " : ""}${v}`).join("\n") : String(value);
}
function display(value) {
  if (value === undefined || value === null) return "—";
  return asArray(value)?.join(", ") ?? String(value);
}

function parse(raw, type) {
  const text = String(raw ?? "").trim();
  if (!text) return { value: null };
  if (type === "text") return { value: text };
  if (type === "time") return TIME_RE.test(text) ? { value: text } : { error: "Enter a valid time in HH:mm format." };
  if (type === "number") {
    const value = Number(text);
    return Number.isFinite(value) ? { value } : { error: "Enter a valid number." };
  }
  const lines = text.split("\n").map(s => s.trim()).filter(Boolean);
  if (type === "string-list") return { value: lines.map(s => s.replace(/^-\s*/, "")).filter(Boolean) };
  if (type === "number-list") {
    const isList = lines.length > 1 || lines.some(s => /^-\s*/.test(s));
    const values = lines.map(s => Number(s.replace(/^-\s*/, "")));
    return values.length && values.every(Number.isFinite)
      ? { value: isList ? values : values[0] }
      : { error: "Enter one number, or one numeric set per line." };
  }
  return { error: `Unknown type: ${type}` };
}

async function updateFrontmatter(date, updates) {
  try {
    const path = `${cleanFolder}/${date}.md`;
    let file = app.vault.getAbstractFileByPath(path);
    if (!file) {
      const normalizedTemplatePath = dailyTemplatePath.replace(/^\/+/, "");
      const template = app.vault.getAbstractFileByPath(normalizedTemplatePath)
        || app.vault.getAbstractFileByPath(`${normalizedTemplatePath}.md`);
      const folder = app.vault.getAbstractFileByPath(cleanFolder);
      const templater = app.plugins.plugins["templater-obsidian"]?.templater;
      if (!template || typeof template.path !== "string" || "children" in template) throw new Error(`Daily template not found: ${dailyTemplatePath}`);
      if (!folder || !Array.isArray(folder.children)) throw new Error(`Daily-note folder not found: ${cleanFolder}`);
      if (!templater?.create_new_note_from_template) throw new Error("Templater is not available; the daily note was not created.");
      await templater.create_new_note_from_template(template, folder, date, false);
      file = app.vault.getAbstractFileByPath(path);
      if (!file || typeof file.path !== "string" || "children" in file) throw new Error(`Templater did not create the expected note: ${path}`);
    }
    await app.fileManager.processFrontMatter(file, fm => Object.assign(fm, updates));
  } catch (error) {
    showNotice(`Habit tracker: ${error.message || error}`);
    throw error;
  }
}

function showNotice(message) {
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.textContent = message;
  Object.assign(notice.style, {
    position: "fixed", right: "20px", top: "20px", zIndex: "10000",
    maxWidth: "420px", padding: "12px 16px", borderRadius: "6px",
    color: "var(--text-normal)", background: "var(--background-primary-alt)",
    boxShadow: "0 2px 12px rgba(0,0,0,.35)"
  });
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 6000);
}

// Tri-state boolean widget: blank (unset) is an empty square, left-click sets/clears true,
// right-click sets/clears false — so "not done" (false) stays visually distinct from "not recorded" (blank).
function triStateBox(parent, value, onChange) {
  let val = value === true ? true : value === false ? false : null;
  const box = parent.createEl("span", { attr: { style: "display:inline-flex;align-items:center;justify-content:center;width:1.4em;height:1.4em;border-radius:3px;font-weight:bold;line-height:1;cursor:pointer;user-select:none" }});
  const paint = () => {
    const state = val === true ? { icon: "✓", color: "var(--text-success,#4caf50)" }
      : val === false ? { icon: "✗", color: "var(--text-error)" }
      : { icon: "", color: "var(--text-faint)" };
    box.textContent = state.icon;
    box.style.color = state.color;
    box.style.border = `2px solid ${state.color}`;
    box.title = val === true ? "True. Left-click to clear, right-click to mark false."
      : val === false ? "False. Right-click to clear, left-click to mark true."
      : "Blank. Left-click to mark true, right-click to mark false.";
  };
  paint();
  box.onclick = e => { e.stopPropagation(); val = val === true ? null : true; paint(); onChange(val); };
  box.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); val = val === false ? null : false; paint(); onChange(val); };
  return box;
}

function typedInput(parent, label, type, value) {
  const box = parent.createEl("div", { attr: { style: "margin-bottom:18px" }});
  box.createEl("label", { text: label, attr: { style: "display:block;font-weight:bold;margin-bottom:5px" }});
  let input, current;
  if (type === "boolean") {
    current = value === true ? true : value === false ? false : null;
    triStateBox(box, current, v => current = v);
    box.createEl("small", { text: "Left-click: true. Right-click: false. Click the active state again to clear." });
  } else if (["text", "string-list", "number-list"].includes(type)) {
    input = box.createEl("textarea", { attr: { style: "width:100%;height:90px;font-family:var(--font-monospace);padding:8px" }});
    input.value = format(value);
  } else {
    input = box.createEl("input", { type: type === "number" ? "number" : type === "time" ? "time" : "text", attr: { style: "width:100%;padding:8px" }});
    input.value = format(value); if (type === "number") input.step = "any";
  }
  if (type === "string-list" || type === "number-list") box.createEl("small", { text: type === "string-list" ? "One text value per line." : "One number, or one numeric set per line." });
  return () => type === "boolean" ? { value: current } : parse(input.value, type);
}

class EditItemDialog {
  constructor(date, page, item, saved) { Object.assign(this, { date, page, item, saved }); }
  open() {
    const dialog = document.createElement("dialog");
    this.dialog = dialog;
    dialog.className = "habit-tracker-dialog";
    Object.assign(dialog.style, {
      width: "min(560px, calc(100vw - 40px))", padding: "24px",
      border: "1px solid var(--background-modifier-border)", borderRadius: "10px",
      color: "var(--text-normal)", background: "var(--background-primary)"
    });
    document.body.appendChild(dialog);
    const el = dialog;
    el.createEl("h2", { text: `Edit ${this.item.label || this.item.key}` });
    el.createEl("div", { text: `Date: ${this.date}`, attr: { style: "margin:-8px 0 20px;color:var(--text-muted)" }});
    const page = this.page || null;
    const readGoal = this.item.goalKey ? typedInput(el, "🎯 Goal (目標)", this.item.goalType, field(page, this.item.goalKey)) : null;
    const readStatus = typedInput(el, "📝 Status", this.item.statusType, field(page, this.item.key));
    const error = el.createEl("div", { attr: { style: "display:none;color:var(--text-error);margin-bottom:12px" }});
    const buttons = el.createEl("div", { attr: { style: "display:flex;justify-content:flex-end;gap:10px" }});
    buttons.createEl("button", { text: "Cancel" }).onclick = () => dialog.close();
    buttons.createEl("button", { text: "Save", cls: "mod-cta" }).onclick = async () => {
      const status = readStatus(), goal = readGoal ? readGoal() : {};
      if (status.error || goal.error) { error.textContent = status.error || goal.error; error.style.display = "block"; return; }
      const updates = { [this.item.key]: status.value };
      if (readGoal) updates[this.item.goalKey] = goal.value;
      await this.saved(updates); dialog.close();
    };
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    dialog.showModal();
  }
}

const root = document.createElement("div"); dv.container.appendChild(root);

function monthWeeks(pages) {
  const map = new Map(); pages.forEach(p => map.set(p.file.day.toFormat("yyyy-MM-dd"), p));
  const start = moment(state.selectedMonth, "YYYY-MM").startOf("month"), end = moment(state.selectedMonth, "YYYY-MM").endOf("month");
  const weeks = {};
  for (let d = moment(start).startOf("isoWeek"); d.isSameOrBefore(end, "day"); d.add(1, "day")) {
    const date = d.format("YYYY-MM-DD"), key = d.format("GGGG-[W]WW");
    (weeks[key] ||= Array(7).fill(null))[d.isoWeekday() - 1] = { date, page: map.get(date) || null };
  }
  return weeks;
}

function checkboxLabel(parent, text, checked, changed) {
  const label = parent.createEl("label", { attr: { style: "display:flex;align-items:center;gap:4px;cursor:pointer" }});
  const input = label.createEl("input", { type: "checkbox" }); input.checked = checked; input.onchange = changed;
  label.createEl("span", { text });
}

function controls(pages) {
  const box = root.createEl("div", { attr: { style: "margin-bottom:20px;padding:15px;background:var(--background-secondary);border-radius:8px" }});
  box.createEl("b", { text: "📅 Select Month:" }); box.createEl("br");
  const months = new Set(pages.map(p => p.file.day.toFormat("yyyy-MM")));
  for (let n = -3; n <= 3; n++) months.add(moment().add(n, "months").format("YYYY-MM"));
  const monthList = [...months].sort().reverse(); if (!monthList.includes(state.selectedMonth)) state.selectedMonth = monthList[0];
  const select = box.createEl("select", { attr: { style: "margin:5px 0 15px;padding:5px" }});
  monthList.forEach(m => { const o = select.createEl("option", { text: m, value: m }); o.selected = m === state.selectedMonth; });
  select.onchange = e => { state.selectedMonth = e.target.value; render(); };
  box.createEl("div", { text: "🗂️ Select Tables:", attr: { style: "font-weight:bold;margin-bottom:5px" }});
  const cats = box.createEl("div", { attr: { style: "display:flex;flex-wrap:wrap;gap:12px;margin-bottom:15px" }});
  habitCategories.forEach(c => checkboxLabel(cats, c.label, state.categoryVisibility[c.id], e => {
    state.categoryVisibility[c.id] = e.target.checked;
    render();
  }));
}

function edit(date, page, item) {
  new EditItemDialog(date, page, item, async updates => { await updateFrontmatter(date, updates); setTimeout(render, 300); }).open();
}

function dataCell(td, day, item) {
  const value = field(day.page, item.key), goal = item.goalKey ? field(day.page, item.goalKey) : null;
  const invalid = validationError(value, item.statusType) || (item.goalType && validationError(goal, item.goalType));
  const done = completion(day.page, item);
  const cell = td.createEl("div", { attr: { title: invalid || "Click to edit", style: `min-height:2em;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:4px;padding:4px;cursor:pointer;color:${invalid ? "var(--text-error)" : done ? "var(--text-success,#4caf50)" : "inherit"}` }});
  if (item.goalKey && present(goal)) cell.createEl("small", { text: `🎯 ${display(goal)}`, attr: { style: "opacity:.65" }});
  if (item.statusType === "boolean") {
    triStateBox(cell, value, async v => { await updateFrontmatter(day.date, { [item.key]: v }); setTimeout(render, 300); });
  } else cell.createEl("div", { text: display(value), attr: { style: "font-size:.85em;word-break:break-word" }});
  if (invalid) cell.createEl("small", { text: "⚠ Invalid type" }); else if (item.goalKey && done) cell.createEl("small", { text: "✓" });
  cell.onmouseenter = () => cell.style.backgroundColor = "var(--background-modifier-hover)";
  cell.onmouseleave = () => cell.style.backgroundColor = "transparent";
  cell.onclick = () => edit(day.date, day.page, item);
}

function habitTable(categories, weeks) {
  const section = root.createEl("section", { attr: { style: "margin:24px 0 36px" }});
  const heading = section.createEl("div", { attr: { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }});
  heading.createEl("h3", { text: "Habits", attr: { style: "margin:0" }});
  const todayButton = heading.createEl("button", { text: "Today", attr: { "aria-label": "Jump to today" }});
  todayButton.onclick = () => {
    state.selectedMonth = moment().format("YYYY-MM");
    render();
    requestAnimationFrame(() => root.querySelector("#habit-today")?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }));
  };
  const items = categories.flatMap(category => category.items.map(item => ({ category, item })));
  if (!items.length) {
    section.createEl("div", { text: "No items are configured in the selected categories.", attr: { style: "padding:12px;color:var(--text-muted);background:var(--background-secondary);border-radius:6px" }}); return;
  }
  const table = section.createEl("table", { cls: "dataview table-view-table", attr: { style: "width:100%;table-layout:fixed;border-collapse:collapse" }});
  const hr = table.createEl("thead").createEl("tr");
  ["Item", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(x => hr.createEl("th", { text: x, attr: { style: x === "Item" ? "width:90px;text-align:left" : "text-align:center" }}));
  const body = table.createEl("tbody");
  Object.keys(weeks).sort().forEach(week => {
    const days = weeks[week], dr = body.createEl("tr");
    dr.createEl("td", { text: week, attr: { style: "font-weight:bold;background:var(--background-secondary);padding:6px;color:var(--text-muted)" }});
    days.forEach(day => {
      const isToday = day?.date === moment().format("YYYY-MM-DD");
      const td = dr.createEl("td", { attr: {
        style: `text-align:center;background:${isToday ? "var(--background-modifier-hover)" : "var(--background-secondary)"};padding:6px;${isToday ? "box-shadow:inset 0 2px var(--interactive-accent);" : ""}`,
        ...(isToday ? { id: "habit-today" } : {})
      }});
      if (!day) return;
      const text = moment(day.date).format("MM-DD");
      if (!day.page) {
        td.createEl("span", { text, attr: { style: "font-weight:bold;color:var(--text-faint)" }});
        return;
      }
      const path = day.page.file.path;
      const link = td.createEl("a", {
        text,
        cls: "internal-link",
        attr: { href: path, "data-href": path, style: "font-weight:bold;cursor:pointer" }
      });
      link.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        app.workspace.openLinkText(path, dv.current().file.path, event.ctrlKey || event.metaKey);
      };
    });
    items.forEach(({ category, item }, n) => {
      const nextCategory = items[n + 1]?.category;
      const categoryEnds = !nextCategory || nextCategory.id !== category.id;
      const border = categoryEnds ? "2px solid var(--background-modifier-border-hover)" : "1px solid var(--background-modifier-border-subtle)";
      const row = body.createEl("tr");
      const label = row.createEl("td", { attr: { style: `font-weight:bold;padding:8px 6px;border-bottom:${border}` }});
      label.createEl("span", { text: item.label || item.key });
      days.forEach(day => {
        const isToday = day?.date === moment().format("YYYY-MM-DD");
        const td = row.createEl("td", { attr: { style: `text-align:center;padding:4px;border-bottom:${border};${isToday ? "background:var(--background-modifier-hover);" : ""}` }});
        if (day) dataCell(td, day, item);
      });
    });
  });
}

function render() {
  root.innerHTML = "";
  const pages = dv.pages(`"${cleanFolder}"`).where(p => p.file.day);
  controls(pages); const weeks = monthWeeks(pages);
  const visibleCategories = habitCategories.filter(c => state.categoryVisibility[c.id]);
  if (visibleCategories.length) habitTable(visibleCategories, weeks);
}
render();
