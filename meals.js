const DEFAULT_NUTRIENT_UNITS = {
    calories: "kcal",
    fat: "g",
    carbohydrates: "g",
    protein: "g",
    sodium: "mg",
    cholesterol: "mg",
    sugar: "g",
    sugars: "g",
    fiber: "g",
    potassium: "mg",
    calcium: "mg",
    iron: "mg",
    "vitamin a": "µg",
    "vitamin b7": "µg",
    "vitamin b9": "µg",
    "vitamin b12": "µg",
    "vitamin d": "µg",
    "vitamin k": "µg",
    retinol: "µg",
    folate: "µg",
    "folic acid": "µg",
    biotin: "µg",
    iodine: "µg",
    selenium: "µg",
    chromium: "µg",
    molybdenum: "µg"
};
const mealsInput = input || {};
const mealsConfig = {
    dailyNotesFolder: "daily",
    mealsProperty: "meals",
    foodFolders: ["foods", "recipes"],
    foodExtensions: ["md", "cook"],
    nutrientPriority: ["calories", "carbohydrates", "fat", "protein", "sodium"],
    ...mealsInput,
    nutrientUnits: {
        ...DEFAULT_NUTRIENT_UNITS,
        ...(mealsInput.nutrientUnits || {})
    }
};

// Dataview re-executes this whole script from scratch on every relevant metadata
// change — including the frontmatter writes this script itself makes when you add
// or edit a food. Without this, that self-triggered refresh would silently reset
// the selected date and re-scan the whole vault for suggestions on every edit.
// Stashing state on `window` lets it survive across those re-executions.
window.__mealsWidgetState = window.__mealsWidgetState || {
    selectedDate: moment().format("YYYY-MM-DD"),
    foodSuggestions: null,
    suggestionsBuiltAt: 0,
    // In-progress text in the "Add a food..." input, plus when it last lost
    // focus. A self-triggered (or vault-wide) metadata change tears down and
    // rebuilds this whole widget mid-keystroke, which blurs the input a beat
    // before this script reruns — so a *recent* blur means "the rerun kicked
    // me out", not "the user clicked away", and is worth restoring/refocusing.
    pendingFoodText: "",
    foodInputBlurredAt: 0
};
const mealsState = window.__mealsWidgetState;
mealsState.expandedNutrientGroups = mealsState.expandedNutrientGroups || {};

// 1. Create a container for our UI
const wrapper = dv.el("div", "");
wrapper.style.display = "flex";
wrapper.style.flexDirection = "column";
wrapper.style.gap = "15px";

function styleInput(el) {
    el.style.padding = "5px";
    el.style.background = "var(--background-modifier-form-field)";
    el.style.color = "var(--text-normal)";
    el.style.border = "1px solid var(--background-modifier-border)";
    el.style.borderRadius = "4px";
}

function makeTh(text) {
    const th = document.createElement("th");
    th.textContent = text;
    return th;
}

function makeTd(text) {
    const td = document.createElement("td");
    td.textContent = text;
    return td;
}

function isServingSizeKey(key) {
    return key.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim() === "serving size";
}

// Keep the numeric value used for calculations separate from any unit explicitly
// written in the source (for example, "230 mg"). A bare YAML number has no
// declared unit, so there is nothing to compare with the table header.
function parseNutrientValue(rawValue) {
    const value = parseFloat(rawValue);
    let unit = null;
    if (typeof rawValue === "string") {
        const match = rawValue.trim().match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*(.+?)\s*$/i);
        if (match) unit = normalizeUnit(match[1]);
    }
    return { value, unit };
}

// Factors are relative to a convenient base unit for each quantity: grams,
// millilitres, and kilocalories. Only units in the same quantity can convert.
const UNIT_DEFINITIONS = {
    "ng":       { quantity: "mass", factor: 0.000000001 },
    "µg":       { quantity: "mass", factor: 0.000001 },
    "mg":       { quantity: "mass", factor: 0.001 },
    "g":        { quantity: "mass", factor: 1 },
    "kg":       { quantity: "mass", factor: 1000 },
    "oz":       { quantity: "mass", factor: 28.349523125 },
    "lb":       { quantity: "mass", factor: 453.59237 },
    "ml":       { quantity: "volume", factor: 1 },
    "cl":       { quantity: "volume", factor: 10 },
    "dl":       { quantity: "volume", factor: 100 },
    "l":        { quantity: "volume", factor: 1000 },
    "tsp":      { quantity: "volume", factor: 4.92892159375 },
    "tbsp":     { quantity: "volume", factor: 14.78676478125 },
    "fl oz":    { quantity: "volume", factor: 29.5735295625 },
    "cup":      { quantity: "volume", factor: 236.5882365 },
    "pt":       { quantity: "volume", factor: 473.176473 },
    "qt":       { quantity: "volume", factor: 946.352946 },
    "gal":      { quantity: "volume", factor: 3785.411784 },
    "cal":      { quantity: "energy", factor: 0.001 },
    "kcal":     { quantity: "energy", factor: 1 },
    "j":        { quantity: "energy", factor: 0.000239005736 },
    "kj":       { quantity: "energy", factor: 0.239005736 }
};

const UNIT_ALIASES = {
    "ug": "µg", "μg": "µg", "mcg": "µg", "microgram": "µg", "micrograms": "µg",
    "milligram": "mg", "milligrams": "mg", "gram": "g", "grams": "g",
    "kilogram": "kg", "kilograms": "kg", "ounce": "oz", "ounces": "oz",
    "pound": "lb", "pounds": "lb", "lbs": "lb",
    "milliliter": "ml", "milliliters": "ml", "millilitre": "ml", "millilitres": "ml",
    "liter": "l", "liters": "l", "litre": "l", "litres": "l",
    "teaspoon": "tsp", "teaspoons": "tsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
    "fluid ounce": "fl oz", "fluid ounces": "fl oz", "floz": "fl oz",
    "cups": "cup", "pint": "pt", "pints": "pt", "quart": "qt", "quarts": "qt",
    "gallon": "gal", "gallons": "gal", "kilocalorie": "kcal", "kilocalories": "kcal",
    "kilojoule": "kj", "kilojoules": "kj", "joule": "j", "joules": "j"
};

function normalizeUnit(unit) {
    const rawUnit = String(unit).trim();
    // On nutrition labels, capital-C "Cal" means a kilocalorie.
    if (rawUnit === "Cal") return "kcal";
    const normalized = rawUnit.toLowerCase().replace(/μ/g, "µ").replace(/\./g, "").replace(/\s+/g, " ");
    return UNIT_ALIASES[normalized] || normalized;
}

function convertUnit(value, sourceUnit, targetUnit) {
    const source = UNIT_DEFINITIONS[normalizeUnit(sourceUnit)];
    const target = UNIT_DEFINITIONS[normalizeUnit(targetUnit)];
    if (!source || !target || source.quantity !== target.quantity) return null;
    return value * source.factor / target.factor;
}

// Priority nutrients are always shown and available for inline custom entry.
const NUTRIENT_PRIORITY = mealsConfig.nutrientPriority;

// Unit mappings for standard table headers
const unitMapping = mealsConfig.nutrientUnits;

function nutrientUnit(key) {
    const exactKey = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(unitMapping, exactKey)) {
        return unitMapping[exactKey];
    }
    const normalized = exactKey.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
    if (Object.prototype.hasOwnProperty.call(unitMapping, normalized)) {
        return unitMapping[normalized];
    }
    if (["carbohydrates", "fat", "protein"].includes(normalized)) return "g";
    const group = nutrientGroup(key);
    if (group === "carbohydrates" || group === "fats") return "g";
    return "mg";
}

// Helper function to parse *all* nutrition keys from raw text (frontmatter of a food/recipe file)
function parseNutritionFromText(content) {
    const nutrition = {};

    const nutritionMatch = content.match(/nutrition:\s*\n([\s\S]*?)(?=\n\w+:|\n---|$)/);
    if (!nutritionMatch) return null;

    const lines = nutritionMatch[1].split('\n');
    for (let line of lines) {
        const parts = line.split(':');
        if (parts.length < 2) continue;

        const key = parts[0].trim();
        const rawVal = parts.slice(1).join(':').trim();
        const val = isServingSizeKey(key) ? rawVal : parseFloat(rawVal);

        if (key && (isServingSizeKey(key) ? rawVal.length > 0 : !isNaN(val))) {
            // Return the original text so its declared unit remains available to
            // the renderer; numeric parsing happens after the source is loaded.
            nutrition[key] = rawVal;
        }
    }

    return Object.keys(nutrition).length > 0 ? nutrition : null;
}

// Helper function to capitalize headers and append units
function formatHeader(key, includeUnit = true) {
    const vitaminName = key.match(/^vitamin[\s_-]+(.+)$/i)?.[1];
    let capitalized = vitaminName
        ? vitaminName.toUpperCase()
        : key.toLowerCase() === "carbohydrates"
            ? "Carbs"
            : key.charAt(0).toUpperCase() + key.slice(1);
    let unit = nutrientUnit(key);
    return includeUnit && unit ? `${capitalized} (${unit})` : capitalized;
}

function formatSubnutrientHeader(key) {
    const group = nutrientGroup(key);
    // Carbohydrate and fat details all use the unit shown on their group
    // heading. The remaining groups can mix mg and µg, so show a unit on each
    // individual subheading instead.
    return formatHeader(key, group !== "carbohydrates" && group !== "fats");
}

// Nutrient details are grouped for display only. Values remain independent:
// child fats/carbohydrates are never summed to manufacture their parent value.
function nutrientGroup(key) {
    const normalized = key.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
    if (/^(vitamin\b|retinol\b|thiamin(e)?\b|riboflavin\b|niacin\b|folate\b|folic acid\b|biotin\b)/.test(normalized)) {
        return "vitamins";
    }
    if (/\b(saturated|monounsaturated|polyunsaturated|trans)\b/.test(normalized) && /\bfat(s)?\b/.test(normalized)) {
        return "fats";
    }
    if (/\b(fiber|fibre|sugar|sugars|added sugar|sugar alcohol|starch|net carb)/.test(normalized)) {
        return "carbohydrates";
    }
    const minerals = new Set([
        "calcium", "chloride", "chromium", "copper", "iodine", "iron",
        "magnesium", "manganese", "molybdenum", "phosphorus", "potassium",
        "selenium", "sodium", "zinc", "salt"
    ]);
    if (minerals.has(normalized)) return "minerals";
    return "other";
}

const NUTRIENT_GROUP_LABELS = {
    carbohydrates: "Carbs",
    fats: "Fat",
    vitamins: "Vitamins",
    minerals: "Minerals",
    other: "Other"
};

// Fuzzy subsequence match: every character of `query` must appear in `text`, in
// order (case-insensitive, ignoring spaces/hyphens/underscores on both sides), so
// "so good" matches "so-good-brand-...". Returns a score (lower = better: tighter,
// earlier matches) or null if `query` doesn't match at all.
function fuzzyScore(query, text) {
    const q = query.toLowerCase().replace(/[-_\s]/g, "");
    const t = text.toLowerCase().replace(/[-_\s]/g, "");
    if (!q) return 0;

    let qi = 0, score = 0, lastMatch = -1;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            if (lastMatch !== -1) score += ti - lastMatch - 1;
            lastMatch = ti;
            qi++;
        }
    }
    if (qi < q.length) return null;

    score += t.indexOf(q[0]); // earlier overall start is a slightly better match
    return score;
}

// Parse a "food" value. A "[[target|alias]]" / "[[target]]" wikilink refers to a
// foods/recipes file; anything else is automatically treated as a one-off custom
// food (no file lookup is attempted for it).
function resolveFoodLink(foodStr) {
    const m = foodStr.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (m) {
        return { target: m[1].trim(), display: (m[2] || m[1]).trim(), isLink: true };
    }
    return { target: foodStr, display: foodStr, isLink: false };
}

// Suggestions for the "add food" autocomplete, keyed by alias since filenames are sluggified
function getFoodSuggestions() {
    const validExtensions = mealsConfig.foodExtensions;
    const targetFolders = mealsConfig.foodFolders;
    const files = app.vault.getFiles().filter(f =>
        validExtensions.includes(f.extension) &&
        targetFolders.some(folder => f.path.startsWith(`${folder}/`))
    );

    const suggestions = [];
    for (const file of files) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        let aliases = fm?.aliases;
        if (typeof aliases === 'string') aliases = aliases.split(',').map(a => a.trim());
        if (!aliases || aliases.length === 0) aliases = [file.basename];
        for (const alias of aliases) {
            if (alias) suggestions.push({ path: file.path.replace(/\.[^/.]+$/, ""), alias: alias.trim() });
        }
    }
    return suggestions;
}

// Rebuilding this means scanning every file in foods/recipes; cache it across the
// script's re-executions (see mealsState above) and only rebuild occasionally so
// our own frontmatter writes don't force a full vault re-scan on every add/edit.
const SUGGESTIONS_TTL_MS = 5 * 60 * 1000;
if (!mealsState.foodSuggestions || Date.now() - mealsState.suggestionsBuiltAt > SUGGESTIONS_TTL_MS) {
    mealsState.foodSuggestions = getFoodSuggestions();
    mealsState.suggestionsBuiltAt = Date.now();
}
const foodSuggestions = mealsState.foodSuggestions;

const foodDatalist = document.createElement("datalist");
foodDatalist.id = "meals-food-datalist";
for (const s of foodSuggestions) {
    const opt = document.createElement("option");
    opt.value = s.alias;
    foodDatalist.appendChild(opt);
}
wrapper.appendChild(foodDatalist);

// Watches a text input for a "[[" trigger and shows a filtered dropdown of the
// given suggestions (matched by alias) below it, like Obsidian's native link
// autocomplete. Selecting an entry inserts "[[path]]" or "[[path|alias]]" in its
// place. The dropdown is fixed-positioned off the real DOM (not the input's
// parent), so it can't get clipped by an ancestor's overflow (e.g. the table's
// scroll wrapper).
function attachLinkSuggest(inputEl, suggestionsList) {
    const dropdown = document.createElement("div");
    dropdown.style.position = "fixed";
    dropdown.style.zIndex = "200";
    dropdown.style.background = "var(--background-primary)";
    dropdown.style.border = "1px solid var(--background-modifier-border)";
    dropdown.style.borderRadius = "4px";
    dropdown.style.maxHeight = "200px";
    dropdown.style.overflowY = "auto";
    dropdown.style.display = "none";
    dropdown.style.minWidth = "200px";
    dropdown.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.3)";
    document.body.appendChild(dropdown);

    let activeIndex = -1;
    let currentMatches = [];
    let linkStart = -1;

    function positionDropdown() {
        const rect = inputEl.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 2}px`;
        dropdown.style.minWidth = `${rect.width}px`;
    }

    function closeDropdown() {
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
        activeIndex = -1;
        currentMatches = [];
        linkStart = -1;
    }

    function selectMatch(match) {
        const before = inputEl.value.slice(0, linkStart);
        const linkText = match.path === match.alias ? `[[${match.path}]]` : `[[${match.path}|${match.alias}]]`;
        inputEl.value = before + linkText;
        closeDropdown();
        inputEl.focus();
    }

    function renderDropdown() {
        dropdown.innerHTML = "";
        if (currentMatches.length === 0) {
            closeDropdown();
            return;
        }
        currentMatches.forEach((m, i) => {
            const item = document.createElement("div");
            item.textContent = m.alias;
            item.style.padding = "4px 8px";
            item.style.cursor = "pointer";
            item.style.backgroundColor = i === activeIndex ? "var(--background-modifier-hover)" : "";
            item.addEventListener("mousedown", (e) => {
                e.preventDefault();
                selectMatch(m);
            });
            dropdown.appendChild(item);
        });
        positionDropdown();
        dropdown.style.display = "block";
    }

    inputEl.addEventListener("input", () => {
        const val = inputEl.value;
        const idx = val.lastIndexOf("[[");
        if (idx === -1) {
            closeDropdown();
            return;
        }
        const afterOpen = val.slice(idx + 2);
        if (afterOpen.includes("]]")) {
            closeDropdown();
            return;
        }
        linkStart = idx;
        const query = afterOpen;
        currentMatches = suggestionsList
            .map(s => ({ s, score: fuzzyScore(query, s.alias) }))
            .filter(m => m.score !== null)
            .sort((a, b) => a.score - b.score)
            .slice(0, 20)
            .map(m => m.s);
        activeIndex = currentMatches.length > 0 ? 0 : -1;
        renderDropdown();
    });

    // Registered before any caller-added keydown listener, and stops immediate
    // propagation on a handled key so a selection/navigation keystroke can't also
    // reach a later listener (e.g. an "Enter to save/submit" handler) on the same input.
    inputEl.addEventListener("keydown", (e) => {
        if (dropdown.style.display === "none") return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopImmediatePropagation();
            activeIndex = Math.min(activeIndex + 1, currentMatches.length - 1);
            renderDropdown();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopImmediatePropagation();
            activeIndex = Math.max(activeIndex - 1, 0);
            renderDropdown();
        } else if (e.key === "Enter") {
            if (activeIndex >= 0) {
                e.preventDefault();
                e.stopImmediatePropagation();
                selectMatch(currentMatches[activeIndex]);
            }
        } else if (e.key === "Escape") {
            e.stopImmediatePropagation();
            closeDropdown();
        }
    });

    inputEl.addEventListener("blur", () => {
        setTimeout(closeDropdown, 150);
    });
    window.addEventListener("scroll", closeDropdown, true);
    window.addEventListener("resize", closeDropdown);

    return { isOpen: () => dropdown.style.display !== "none" };
}

// 2. Calendar date picker
const folderPath = mealsConfig.dailyNotesFolder;
let selectedDate = mealsState.selectedDate;
let calendarViewMonth = moment(selectedDate, "YYYY-MM-DD");

const dateWrapperPos = document.createElement("div");
dateWrapperPos.style.position = "relative";
dateWrapperPos.style.width = "fit-content";

const dateButton = document.createElement("button");
styleInput(dateButton);
dateButton.style.cursor = "pointer";
dateButton.style.textAlign = "left";
dateButton.style.width = "fit-content";

function updateDateButtonLabel() {
    dateButton.textContent = moment(selectedDate, "YYYY-MM-DD").format("ddd, MMM D, YYYY");
}
updateDateButtonLabel();

const calendarPopup = document.createElement("div");
calendarPopup.style.display = "none";
calendarPopup.style.position = "absolute";
calendarPopup.style.top = "calc(100% + 4px)";
calendarPopup.style.left = "0";
calendarPopup.style.zIndex = "100";
calendarPopup.style.background = "var(--background-primary)";
calendarPopup.style.border = "1px solid var(--background-modifier-border)";
calendarPopup.style.borderRadius = "6px";
calendarPopup.style.padding = "10px";
calendarPopup.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.3)";

// Which dates (YYYY-MM-DD) in the given month already have meal entries
function getDatesWithEntriesForMonth(monthMoment) {
    const prefix = monthMoment.format("YYYY-MM");
    const files = app.vault.getFiles().filter(f =>
        f.extension === "md" &&
        f.path.startsWith(`${folderPath}/`) &&
        f.basename.startsWith(prefix)
    );

    const set = new Set();
    for (const file of files) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        const meals = fm?.[mealsConfig.mealsProperty];
        if (Array.isArray(meals) && meals.length > 0) {
            set.add(file.basename);
        }
    }
    return set;
}

function renderCalendar() {
    calendarPopup.innerHTML = "";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "8px";
    header.style.gap = "8px";

    const prevBtn = document.createElement("button");
    prevBtn.textContent = "‹";
    prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        calendarViewMonth = calendarViewMonth.clone().subtract(1, "month");
        renderCalendar();
    });

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "›";
    nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        calendarViewMonth = calendarViewMonth.clone().add(1, "month");
        renderCalendar();
    });

    const label = document.createElement("span");
    label.style.fontWeight = "bold";
    label.textContent = calendarViewMonth.format("MMMM YYYY");

    header.appendChild(prevBtn);
    header.appendChild(label);
    header.appendChild(nextBtn);
    calendarPopup.appendChild(header);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(7, 32px)";
    grid.style.gap = "2px";

    for (const d of ["S", "M", "T", "W", "T", "F", "S"]) {
        const cell = document.createElement("div");
        cell.textContent = d;
        cell.style.textAlign = "center";
        cell.style.fontSize = "0.75em";
        cell.style.color = "var(--text-muted)";
        grid.appendChild(cell);
    }

    const startOfMonth = calendarViewMonth.clone().startOf("month");
    const startDay = startOfMonth.day();
    const daysInMonth = calendarViewMonth.daysInMonth();
    const datesWithEntries = getDatesWithEntriesForMonth(calendarViewMonth);
    const todayStr = moment().format("YYYY-MM-DD");

    for (let i = 0; i < startDay; i++) {
        grid.appendChild(document.createElement("div"));
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cellDateStr = startOfMonth.clone().date(day).format("YYYY-MM-DD");
        const hasEntries = datesWithEntries.has(cellDateStr);
        const isSelected = cellDateStr === selectedDate;

        const btn = document.createElement("button");
        btn.textContent = String(day);
        btn.style.width = "32px";
        btn.style.height = "32px";
        btn.style.border = cellDateStr === todayStr ? "1px solid var(--interactive-accent)" : "1px solid transparent";
        btn.style.borderRadius = "4px";
        btn.style.cursor = "pointer";
        btn.style.background = hasEntries ? "var(--interactive-accent)" : "transparent";
        btn.style.color = hasEntries ? "var(--text-on-accent)" : "var(--text-normal)";
        btn.style.fontWeight = isSelected ? "bold" : "normal";
        btn.style.outline = isSelected ? "2px solid var(--text-normal)" : "none";

        btn.addEventListener("click", () => {
            selectedDate = cellDateStr;
            mealsState.selectedDate = cellDateStr;
            updateDateButtonLabel();
            calendarPopup.style.display = "none";
            renderMealsTable(selectedDate);
        });

        grid.appendChild(btn);
    }

    calendarPopup.appendChild(grid);
}

dateButton.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = calendarPopup.style.display === "block";
    if (isOpen) {
        calendarPopup.style.display = "none";
        return;
    }
    calendarViewMonth = moment(selectedDate, "YYYY-MM-DD");
    renderCalendar();
    calendarPopup.style.display = "block";
});

document.addEventListener("click", (e) => {
    if (!dateWrapperPos.contains(e.target)) {
        calendarPopup.style.display = "none";
    }
});

dateWrapperPos.appendChild(dateButton);
dateWrapperPos.appendChild(calendarPopup);
wrapper.appendChild(dateWrapperPos);

const outputArea = document.createElement("div");
wrapper.appendChild(outputArea);

// 3. Main function: render the meals table (and its inline "add food" row) for a given date.
// The table is always shown, even with zero entries, so a food can always be added.
async function renderMealsTable(dateStr) {
    outputArea.innerHTML = "";

    const filePath = `${folderPath}/${dateStr}.md`;
    const file = app.vault.getAbstractFileByPath(filePath);

    if (!file) {
        outputArea.innerHTML = `<em>No daily note found for <strong>${dateStr}</strong> at <code>${filePath}</code>.</em>`;
        return;
    }

    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    // A local, mutable copy of the entries. Edits below mutate this directly and
    // re-render from it immediately, instead of re-reading from Obsidian's
    // metadata cache — that cache can still be stale for a moment right after our
    // own `processFrontMatter` write resolves, which was the real source of the
    // remaining delay even after force-refreshing Dataview.
    const storedEntries = fm?.[mealsConfig.mealsProperty];
    let entries = Array.isArray(storedEntries) ? storedEntries.map(e => ({ ...e })) : [];

    // Persists the current in-memory `entries` to disk and asks Dataview to
    // refresh other views. The on-screen table is already up to date by the time
    // this runs (see rebuildTable below), so this doesn't gate the visible response.
    async function persistMeals() {
        // Keep optional comments out of YAML unless they contain visible text.
        for (const entry of entries) {
            if (typeof entry.comment === "string") {
                entry.comment = entry.comment.trim();
                if (!entry.comment) delete entry.comment;
            } else if (entry.comment != null) {
                entry.comment = String(entry.comment).trim();
                if (!entry.comment) delete entry.comment;
            }
        }
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm[mealsConfig.mealsProperty] = entries;
        });
        app.workspace.trigger("dataview:refresh-views");
    }

    async function rebuildTable() {
    // Expanding/collapsing a nutrient group rebuilds the whole table. Preserve
    // the scroll position from the container that is about to be replaced so a
    // header click does not send the user back to the left edge (or the top).
    const previousTableContainer = outputArea.querySelector(".meals-table-container");
    const previousScrollLeft = previousTableContainer?.scrollLeft || 0;
    const previousScrollTop = previousTableContainer?.scrollTop || 0;
    outputArea.innerHTML = "";
    let allKeys = new Set(NUTRIENT_PRIORITY);
    let foodsData = [];
    let totals = {};

    for (let entry of entries) {
        const { target, display, isLink } = resolveFoodLink(entry.food);
        const servings = parseFloat(entry.amount);
        let nutrition = null;
        let nutritionUnits = {};

        if (entry.nutrition) {
            nutrition = {};
            for (let [k, v] of Object.entries(entry.nutrition)) {
                if (isServingSizeKey(k)) {
                    nutrition[k] = v;
                    continue;
                }
                const { value: val, unit } = parseNutrientValue(v);
                if (!isNaN(val)) nutrition[k] = val;
                if (unit) nutritionUnits[k] = unit;
            }
        } else if (isLink) {
            // Resolve the link the same way Obsidian itself would (handles a bare
            // basename like "name" as well as a full path like "foods/name").
            const targetFile = app.metadataCache.getFirstLinkpathDest(target, file.path);
            if (targetFile) {
                const targetFm = app.metadataCache.getFileCache(targetFile)?.frontmatter;
                if (targetFm?.nutrition) {
                    nutrition = {};
                    for (let k of Object.keys(targetFm.nutrition)) {
                        if (isServingSizeKey(k)) {
                            nutrition[k] = targetFm.nutrition[k];
                            continue;
                        }
                        const { value: val, unit } = parseNutrientValue(targetFm.nutrition[k]);
                        if (!isNaN(val)) nutrition[k] = val;
                        if (unit) nutritionUnits[k] = unit;
                    }
                } else {
                    let foodContent = await app.vault.read(targetFile);
                    const parsedNutrition = parseNutritionFromText(foodContent);
                    if (parsedNutrition) {
                        nutrition = {};
                        for (const [k, rawValue] of Object.entries(parsedNutrition)) {
                            if (isServingSizeKey(k)) {
                                nutrition[k] = rawValue;
                                continue;
                            }
                            const { value, unit } = parseNutrientValue(rawValue);
                            if (!isNaN(value)) nutrition[k] = value;
                            if (unit) nutritionUnits[k] = unit;
                        }
                    }
                }
            }
        }
        // else: plain, non-wikilink food with no inline nutrition — treated as a
        // custom food with unknown nutrition. No lookup, no error, just an
        // incomplete row (shown with "-" below).

        const foodRow = {
            name: display,
            rawFood: entry.food,
            comment: entry.comment == null ? "" : String(entry.comment),
            servings: servings,
            servingSize: "-",
            nutrients: {},
            nutrientUnits: nutritionUnits,
            nutrientIssues: {},
            nutrientConversions: {},
            incomplete: !nutrition,
            isLink: isLink,
            // Raw (pre-serving-multiplication) nutrition, editable only for custom
            // (non-wikilink) foods since that's what's actually stored inline.
            rawNutrition: (!isLink && nutrition) ? { ...nutrition } : {}
        };

        if (nutrition) {
            for (let [k, v] of Object.entries(nutrition)) {
                if (isServingSizeKey(k)) {
                    foodRow.servingSize = String(v);
                    continue;
                }
                // "Carbs" is only the table's compact display label. Nutrition
                // data is sourced exclusively from the "carbohydrates" field.
                if (k.toLowerCase() === "carbs") continue;

                allKeys.add(k);
                const sourceUnit = nutritionUnits[k];
                const headerUnit = nutrientUnit(k);
                let valueForColumn = v;
                let includeInTotal = true;

                if (sourceUnit && headerUnit && sourceUnit !== normalizeUnit(headerUnit)) {
                    const converted = convertUnit(v, sourceUnit, headerUnit);
                    if (converted === null) {
                        includeInTotal = false;
                        foodRow.nutrientIssues[k] = `Cannot convert ${sourceUnit} to ${headerUnit}; excluded from total`;
                    } else {
                        valueForColumn = converted;
                        foodRow.nutrientConversions[k] = `Converted from ${sourceUnit} to ${headerUnit}`;
                    }
                }

                let calculatedValue = valueForColumn * servings;
                foodRow.nutrients[k] = calculatedValue;
                if (includeInTotal) totals[k] = (totals[k] || 0) + calculatedValue;
            }
        }

        foodsData.push(foodRow);
    }

    // Convert keys to array and sort (prioritizing major macros first)
    let keyArray = Array.from(allKeys).sort((a, b) => {
        let idxA = NUTRIENT_PRIORITY.indexOf(a.toLowerCase());
        let idxB = NUTRIENT_PRIORITY.indexOf(b.toLowerCase());
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        // Sort numbered nutrients naturally (for example B1, B6, B12) rather
        // than lexicographically, which would place B12 immediately after B1.
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });

    const priorityKeys = keyArray.filter(k => NUTRIENT_PRIORITY.includes(k.toLowerCase()));
    const groupedKeys = {
        carbohydrates: [],
        fats: [],
        vitamins: [],
        minerals: [],
        other: []
    };
    for (const k of keyArray) {
        if (!priorityKeys.includes(k)) groupedKeys[nutrientGroup(k)].push(k);
    }

    // When a macro's detail group is collapsed, its single group column can
    // still repeat the total from the corresponding prioritized macro column.
    // Respect custom nutrientPriority settings: no priority column means no
    // duplicated group total.
    const groupPriorityKeys = {
        carbohydrates: priorityKeys.find(k => k.toLowerCase() === "carbohydrates"),
        fats: priorityKeys.find(k => k.toLowerCase() === "fat")
    };

    // 4. Build the table
    const tableContainer = document.createElement("div");
    tableContainer.className = "meals-table-container";
    // Keep a long table within the viewport and make this the scroll container.
    // The header below can then remain visible during both vertical and
    // horizontal scrolling.
    tableContainer.style.maxHeight = "70vh";
    tableContainer.style.overflow = "auto";

    const table = document.createElement("table");
    table.className = "dataview table-view-table";
    table.style.width = "100%";
    table.style.whiteSpace = "nowrap";
    table.style.borderCollapse = "separate";
    table.style.borderSpacing = "0";

    const thead = document.createElement("thead");
    thead.style.backgroundColor = "var(--background-secondary)";
    const headerRow = document.createElement("tr");
    const subheaderRow = document.createElement("tr");
    headerRow.className = "table-view-tr-header";
    subheaderRow.className = "table-view-tr-header";
    headerRow.style.backgroundColor = "var(--background-secondary)";
    subheaderRow.style.backgroundColor = "var(--background-secondary)";
    // Reserve the second header tier even while every category is collapsed.
    // This prevents expanding a category from making the sticky area jump.
    subheaderRow.style.height = "28px";

    function appendFlatHeader(text) {
        const th = makeTh(text);
        th.rowSpan = 2;
        headerRow.appendChild(th);
    }

    function appendGroupHeader(group) {
        const keys = groupedKeys[group];
        const expanded = Boolean(mealsState.expandedNutrientGroups[group]) && keys.length > 0;
        const priorityKey = groupPriorityKeys[group];
        const groupUnit = priorityKey ? nutrientUnit(priorityKey)
            : (group === "carbohydrates" || group === "fats" ? "g" : null);
        const label = groupUnit
            ? `${NUTRIENT_GROUP_LABELS[group]} (${groupUnit})`
            : NUTRIENT_GROUP_LABELS[group];
        const th = makeTh(`${label} ${expanded ? "▾" : "▸"}`);
        th.style.cursor = "pointer";
        th.title = `${expanded ? "Hide" : "Show"} ${NUTRIENT_GROUP_LABELS[group].toLowerCase()} fields`;
        th.addEventListener("click", async () => {
            mealsState.expandedNutrientGroups[group] = !mealsState.expandedNutrientGroups[group];
            await rebuildTable();
        });
        if (expanded) {
            th.colSpan = keys.length + (priorityKey ? 1 : 0);
            if (priorityKey) subheaderRow.appendChild(makeTh(formatHeader(priorityKey, false)));
            for (const k of keys) subheaderRow.appendChild(makeTh(formatSubnutrientHeader(k)));
        } else {
            th.rowSpan = 2;
        }
        headerRow.appendChild(th);
    }

    appendFlatHeader("Food");
    appendFlatHeader("Servings");
    appendFlatHeader("Serving Size");
    for (const k of priorityKeys) {
        appendFlatHeader(formatHeader(k));
    }
    appendFlatHeader("Comment");
    for (const group of ["carbohydrates", "fats", "vitamins", "minerals", "other"]) appendGroupHeader(group);
    appendFlatHeader("");
    for (const row of [headerRow, subheaderRow]) {
        for (const cell of row.cells) {
            cell.style.backgroundColor = "var(--background-secondary)";
            cell.style.borderBottom = "0";
        }
    }
    thead.appendChild(headerRow);
    thead.appendChild(subheaderRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    const totalsBackground = "color-mix(in srgb, var(--background-secondary) 50%, var(--background-primary))";
    const totalsRow = document.createElement("tr");
    totalsRow.style.fontWeight = "bold";
    totalsRow.style.backgroundColor = totalsBackground;
    totalsRow.style.borderTop = "0";
    totalsRow.style.borderBottom = "2px solid var(--background-modifier-border)";
    totalsRow.appendChild(makeTd("TOTALS"));
    totalsRow.appendChild(makeTd("-"));
    totalsRow.appendChild(makeTd("-"));
    for (const k of priorityKeys) {
        totalsRow.appendChild(makeTd((totals[k] || 0).toFixed(1)));
    }
    totalsRow.appendChild(makeTd(""));
    for (const group of ["carbohydrates", "fats", "vitamins", "minerals", "other"]) {
        if (mealsState.expandedNutrientGroups[group] && groupedKeys[group].length > 0) {
            const priorityKey = groupPriorityKeys[group];
            if (priorityKey) totalsRow.appendChild(makeTd((totals[priorityKey] || 0).toFixed(1)));
            for (const k of groupedKeys[group]) totalsRow.appendChild(makeTd((totals[k] || 0).toFixed(1)));
        } else {
            const priorityKey = groupPriorityKeys[group];
            totalsRow.appendChild(makeTd(priorityKey ? (totals[priorityKey] || 0).toFixed(1) : ""));
        }
    }
    totalsRow.appendChild(makeTd(""));
    // Obsidian themes may leave individual table cells transparent. Give every
    // totals cell an opaque background so scrolling rows cannot show through
    // the gaps between cells.
    for (const cell of totalsRow.cells) {
        cell.style.backgroundColor = totalsBackground;
        cell.style.border = "0";
        cell.style.borderBottom = "2px solid var(--background-modifier-border)";
    }
    // Keep totals together with the sticky column headings rather than letting
    // them scroll away with the entry rows.
    thead.appendChild(totalsRow);

    // Trailing cell with a "−" button that removes this entry from `meals`.
    function buildRemoveCell(entryIndex) {
        const td = document.createElement("td");
        const btn = document.createElement("button");
        btn.textContent = "−";
        btn.title = "Remove entry";
        btn.style.color = "var(--text-error)";
        btn.style.lineHeight = "1";

        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            entries.splice(entryIndex, 1);
            await rebuildTable();
            persistMeals();
        });

        td.appendChild(btn);
        return td;
    }

    // Food-name cell, editable independently of the nutrition-edit row: click it to
    // rename/re-link the entry, with "[[" triggering foods/recipes note search.
    function buildFoodCell(food, entryIndex) {
        const td = document.createElement("td");
        td.textContent = food.name;
        td.style.cursor = "pointer";
        td.title = "Click to edit food";

        td.addEventListener("click", (e) => {
            e.stopPropagation();

            const editTd = document.createElement("td");
            const inp = document.createElement("input");
            inp.type = "text";
            inp.value = food.rawFood;
            inp.style.width = "100%";
            inp.style.minWidth = "150px";
            styleInput(inp);
            inp.setAttribute("list", "meals-food-datalist");
            editTd.appendChild(inp);
            td.replaceWith(editTd);
            inp.focus();
            inp.select();

            const linkSuggest = attachLinkSuggest(inp, foodSuggestions);

            async function saveFoodEdit() {
                const newValue = inp.value.trim();
                if (!newValue || newValue === food.rawFood) {
                    await rebuildTable();
                    return;
                }
                entries[entryIndex].food = newValue;
                await rebuildTable();
                persistMeals();
            }

            inp.addEventListener("keydown", (e2) => {
                if (linkSuggest.isOpen()) return;
                if (e2.key === "Enter") saveFoodEdit();
                if (e2.key === "Escape") rebuildTable();
            });
            inp.addEventListener("blur", () => {
                setTimeout(() => {
                    if (!linkSuggest.isOpen()) saveFoodEdit();
                }, 200);
            });
        });

        return td;
    }

    // Comments are optional for every kind of food entry. An empty edit removes
    // the property entirely so blank comments are never serialized to YAML.
    function buildCommentCell(food, entryIndex) {
        const td = makeTd(food.comment);
        td.style.cursor = "text";
        td.style.maxWidth = "180px";
        td.style.overflow = "hidden";
        td.style.textOverflow = "ellipsis";
        td.title = "Click to edit comment";

        td.addEventListener("click", (e) => {
            e.stopPropagation();
            if (td.querySelector("input")) return;

            const inp = document.createElement("input");
            inp.type = "text";
            inp.value = food.comment;
            inp.placeholder = "Add a comment...";
            inp.style.width = "100%";
            inp.style.minWidth = "140px";
            styleInput(inp);
            td.textContent = "";
            td.appendChild(inp);
            inp.focus();
            inp.select();

            let finished = false;
            async function finish(save) {
                if (finished) return;
                finished = true;
                if (save) {
                    const comment = inp.value.trim();
                    if (comment) entries[entryIndex].comment = comment;
                    else delete entries[entryIndex].comment;
                    await rebuildTable();
                    persistMeals();
                } else {
                    await rebuildTable();
                }
            }

            inp.addEventListener("click", (e2) => e2.stopPropagation());
            inp.addEventListener("keydown", (e2) => {
                if (e2.key === "Enter") finish(true);
                if (e2.key === "Escape") finish(false);
            });
            inp.addEventListener("blur", () => finish(true));
        });

        return td;
    }

    // `amount` is the number of product servings consumed. It is editable for
    // linked products and one-off custom foods alike.
    function buildServingsCell(food, entryIndex) {
        const td = makeTd(String(food.servings));
        td.style.cursor = "pointer";
        td.title = "Click to edit servings consumed";

        td.addEventListener("click", (e) => {
            e.stopPropagation();
            const inp = document.createElement("input");
            inp.type = "number";
            inp.step = "0.1";
            inp.min = "0";
            inp.value = String(food.servings);
            inp.style.width = "70px";
            styleInput(inp);
            td.textContent = "";
            td.appendChild(inp);
            inp.focus();
            inp.select();

            let finished = false;
            async function finish(save) {
                if (finished) return;
                finished = true;
                const value = parseFloat(inp.value);
                if (save && !isNaN(value) && value >= 0) {
                    entries[entryIndex].amount = value;
                    await rebuildTable();
                    persistMeals();
                } else {
                    await rebuildTable();
                }
            }

            inp.addEventListener("click", (e2) => e2.stopPropagation());
            inp.addEventListener("keydown", (e2) => {
                if (e2.key === "Enter") finish(true);
                if (e2.key === "Escape") finish(false);
            });
            inp.addEventListener("blur", () => finish(true));
        });

        return td;
    }

    function buildDisplayRow(food, entryIndex) {
        const tr = document.createElement("tr");
        tr.appendChild(buildFoodCell(food, entryIndex));
        tr.appendChild(buildServingsCell(food, entryIndex));
        tr.appendChild(makeTd(food.servingSize));

        function appendNutrient(k) {
            let text = food.nutrients.hasOwnProperty(k) ? food.nutrients[k].toFixed(1) : "";
            if (food.nutrientIssues[k] && food.nutrientUnits[k]) text += ` ${food.nutrientUnits[k]}`;
            const nutrientCell = makeTd(text);
            if (food.nutrientIssues[k]) {
                nutrientCell.style.color = "var(--text-error)";
                nutrientCell.style.fontWeight = "bold";
                nutrientCell.title = food.nutrientIssues[k];
            } else if (food.nutrientConversions[k]) nutrientCell.title = food.nutrientConversions[k];
            tr.appendChild(nutrientCell);
        }

        for (const k of priorityKeys) {
            appendNutrient(k);
        }
        tr.appendChild(buildCommentCell(food, entryIndex));
        for (const group of ["carbohydrates", "fats", "vitamins", "minerals", "other"]) {
            if (mealsState.expandedNutrientGroups[group] && groupedKeys[group].length > 0) {
                const priorityKey = groupPriorityKeys[group];
                if (priorityKey) appendNutrient(priorityKey);
                for (const k of groupedKeys[group]) appendNutrient(k);
            } else {
                const priorityKey = groupPriorityKeys[group];
                if (priorityKey) appendNutrient(priorityKey);
                else tr.appendChild(makeTd(""));
            }
        }
        tr.appendChild(buildRemoveCell(entryIndex));

        if (!food.isLink) {
            tr.style.cursor = "pointer";
            tr.title = "Click to edit nutrition";
            tr.addEventListener("mouseenter", () => { tr.style.backgroundColor = "var(--background-modifier-hover)"; });
            tr.addEventListener("mouseleave", () => { tr.style.backgroundColor = ""; });
            tr.addEventListener("click", () => {
                const editTr = buildEditRow(food, entryIndex);
                tr.replaceWith(editTr);
                const firstInput = editTr.querySelector("input");
                if (firstInput) firstInput.focus();
            });
        }

        return tr;
    }

    // Editable row for a custom (non-wikilink) food — lets you fill in/correct its
    // inline nutrition values directly from the table.
    function buildEditRow(food, entryIndex) {
        const tr = document.createElement("tr");
        tr.appendChild(buildFoodCell(food, entryIndex));
        tr.appendChild(buildServingsCell(food, entryIndex));
        tr.appendChild(makeTd(food.servingSize));

        const editInputs = {};
        const mirroredEditInputs = [];
        function appendNutrientInput(k) {
            const cell = document.createElement("td");
            const inp = document.createElement("input");
            inp.type = "number";
            inp.step = "0.1";
            inp.style.width = "70px";
            styleInput(inp);
            const rawVal = food.rawNutrition[k];
            inp.value = rawVal !== undefined ? rawVal : "";
            editInputs[k] = inp;
            cell.appendChild(inp);
            tr.appendChild(cell);
        }
        function appendMirroredNutrientInput(k) {
            const cell = document.createElement("td");
            const inp = document.createElement("input");
            inp.type = "number";
            inp.step = "0.1";
            inp.style.width = "70px";
            styleInput(inp);
            const sourceInput = editInputs[k];
            inp.value = sourceInput?.value || "";
            if (sourceInput) {
                inp.addEventListener("input", () => { sourceInput.value = inp.value; });
                sourceInput.addEventListener("input", () => { inp.value = sourceInput.value; });
            }
            mirroredEditInputs.push(inp);
            cell.appendChild(inp);
            tr.appendChild(cell);
        }
        for (const k of priorityKeys) {
            appendNutrientInput(k);
        }
        tr.appendChild(buildCommentCell(food, entryIndex));
        for (const group of ["carbohydrates", "fats", "vitamins", "minerals", "other"]) {
            if (mealsState.expandedNutrientGroups[group] && groupedKeys[group].length > 0) {
                const priorityKey = groupPriorityKeys[group];
                if (priorityKey) appendMirroredNutrientInput(priorityKey);
                for (const k of groupedKeys[group]) appendNutrientInput(k);
            } else {
                const priorityKey = groupPriorityKeys[group];
                if (priorityKey) appendMirroredNutrientInput(priorityKey);
                else tr.appendChild(makeTd(""));
            }
        }
        tr.appendChild(buildRemoveCell(entryIndex));

        async function saveEdit() {
            // Preserve metadata outside the displayed nutrient columns (including
            // serving size) while replacing the editable displayed values.
            const nutrition = { ...food.rawNutrition };
            for (const [k, inp] of Object.entries(editInputs)) {
                const val = parseFloat(inp.value);
                if (!isNaN(val)) nutrition[k] = val;
                else delete nutrition[k];
            }
            if (Object.keys(nutrition).length > 0) {
                entries[entryIndex].nutrition = nutrition;
            } else {
                delete entries[entryIndex].nutrition;
            }
            await rebuildTable();
            persistMeals();
        }

        for (const inp of [...Object.values(editInputs), ...mirroredEditInputs]) {
            inp.addEventListener("keydown", (e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") rebuildTable();
            });
        }
        tr.addEventListener("focusout", () => {
            setTimeout(() => {
                if (!tr.contains(document.activeElement)) saveEdit();
            }, 0);
        });

        return tr;
    }

    foodsData.forEach((food, idx) => {
        tbody.appendChild(buildDisplayRow(food, idx));
    });

    // 5. "Add food" row — append an entry to the note's `meals` frontmatter property on the fly.
    // Food is a text input with alias autocomplete; if the typed text isn't a known
    // alias it's saved as a plain (non-wikilink) custom food. Every nutrient column
    // currently displayed gets an optional input for one-off foods.
    const addRow = document.createElement("tr");

    const foodCell = document.createElement("td");
    const foodInput = document.createElement("input");
    foodInput.type = "text";
    foodInput.placeholder = "Add a food...";
    foodInput.className = "meals-add-food-input";
    foodInput.setAttribute("list", "meals-food-datalist");
    foodInput.style.width = "100%";
    foodInput.style.minWidth = "150px";
    styleInput(foodInput);
    foodCell.appendChild(foodInput);
    addRow.appendChild(foodCell);
    const addFoodLinkSuggest = attachLinkSuggest(foodInput, foodSuggestions);

    // Restore text left mid-typing when a rerun (see the window state comment
    // up top) tore this input down a moment ago, and pick up typing back up
    // where it left off instead of leaving an empty box.
    if (mealsState.pendingFoodText && Date.now() - mealsState.foodInputBlurredAt < 750) {
        foodInput.value = mealsState.pendingFoodText;
        setTimeout(() => {
            foodInput.focus();
            foodInput.setSelectionRange(foodInput.value.length, foodInput.value.length);
        }, 0);
    }
    foodInput.addEventListener("input", () => {
        mealsState.pendingFoodText = foodInput.value;
    });
    foodInput.addEventListener("blur", () => {
        mealsState.foodInputBlurredAt = Date.now();
    });

    const amountCell = document.createElement("td");
    const amountInput = document.createElement("input");
    amountInput.type = "number";
    amountInput.step = "0.1";
    amountInput.value = "1";
    amountInput.style.width = "70px";
    styleInput(amountInput);
    amountCell.appendChild(amountInput);
    addRow.appendChild(amountCell);
    addRow.appendChild(makeTd(""));

    const nutritionInputs = {};
    const mirroredNutritionInputs = [];
    function appendAddNutrientInput(k) {
        const cell = document.createElement("td");
        const inp = document.createElement("input");
        inp.type = "number";
        inp.step = "0.1";
        inp.style.width = "70px";
        styleInput(inp);
        nutritionInputs[k] = inp;
        cell.appendChild(inp);
        addRow.appendChild(cell);
    }
    function appendMirroredAddNutrientInput(k) {
        const cell = document.createElement("td");
        const inp = document.createElement("input");
        inp.type = "number";
        inp.step = "0.1";
        inp.style.width = "70px";
        styleInput(inp);
        const sourceInput = nutritionInputs[k];
        inp.value = sourceInput?.value || "";
        if (sourceInput) {
            inp.addEventListener("input", () => { sourceInput.value = inp.value; });
            sourceInput.addEventListener("input", () => { inp.value = sourceInput.value; });
        }
        mirroredNutritionInputs.push(inp);
        cell.appendChild(inp);
        addRow.appendChild(cell);
    }
    for (const k of priorityKeys) {
        appendAddNutrientInput(k);
    }

    const commentCell = document.createElement("td");
    const commentInput = document.createElement("input");
    commentInput.type = "text";
    commentInput.placeholder = "Comment...";
    commentInput.style.width = "120px";
    styleInput(commentInput);
    commentCell.appendChild(commentInput);
    addRow.appendChild(commentCell);

    for (const group of ["carbohydrates", "fats", "vitamins", "minerals", "other"]) {
        if (mealsState.expandedNutrientGroups[group] && groupedKeys[group].length > 0) {
            const priorityKey = groupPriorityKeys[group];
            if (priorityKey) appendMirroredAddNutrientInput(priorityKey);
            for (const k of groupedKeys[group]) appendAddNutrientInput(k);
        } else {
            const priorityKey = groupPriorityKeys[group];
            if (priorityKey) appendMirroredAddNutrientInput(priorityKey);
            else addRow.appendChild(makeTd(""));
        }
    }
    addRow.appendChild(makeTd(""));
    tbody.appendChild(addRow);

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    outputArea.appendChild(tableContainer);
    tableContainer.scrollLeft = previousScrollLeft;
    tableContainer.scrollTop = previousScrollTop;

    // Chromium can flicker when an entire multi-row <thead> is sticky inside an
    // overflow container. Stick its cells individually at measured row offsets
    // instead, so the two header tiers and totals form one stable stack.
    function positionStickyHeaderCells() {
        const headerHeight = headerRow.getBoundingClientRect().height;
        const subheaderHeight = subheaderRow.getBoundingClientRect().height;
        for (const cell of headerRow.cells) {
            cell.style.position = "sticky";
            cell.style.top = "0px";
            cell.style.zIndex = "13";
        }
        for (const cell of subheaderRow.cells) {
            cell.style.position = "sticky";
            cell.style.top = `${headerHeight}px`;
            cell.style.zIndex = "12";
        }
        for (const cell of totalsRow.cells) {
            cell.style.position = "sticky";
            cell.style.top = `${headerHeight + subheaderHeight}px`;
            cell.style.zIndex = "11";
        }
    }
    positionStickyHeaderCells();
    requestAnimationFrame(positionStickyHeaderCells);

    const addControls = document.createElement("div");
    addControls.style.display = "flex";
    addControls.style.alignItems = "center";
    addControls.style.gap = "10px";
    addControls.style.marginTop = "8px";

    const addButton = document.createElement("button");
    addButton.textContent = "Add food";

    const addStatus = document.createElement("span");
    addStatus.style.fontSize = "0.85em";
    addStatus.style.color = "var(--text-muted)";

    addControls.appendChild(addButton);
    addControls.appendChild(addStatus);
    outputArea.appendChild(addControls);

    async function handleAddFood() {
        const typedText = foodInput.value.trim();
        if (!typedText) {
            addStatus.textContent = "Enter a food name.";
            return;
        }

        const amount = parseFloat(amountInput.value);
        if (isNaN(amount)) {
            addStatus.textContent = "Enter a valid serving amount.";
            return;
        }

        // A "[[...]]" already typed/selected via the link search is used as-is;
        // otherwise resolve against known aliases, falling back to a plain custom food.
        let foodValue;
        if (/^\[\[.+\]\]$/.test(typedText)) {
            foodValue = typedText;
        } else {
            const suggestionMatch = foodSuggestions.find(s => s.alias.toLowerCase() === typedText.toLowerCase());
            if (suggestionMatch) {
                foodValue = suggestionMatch.path === suggestionMatch.alias
                    ? `[[${suggestionMatch.path}]]`
                    : `[[${suggestionMatch.path}|${suggestionMatch.alias}]]`;
            } else {
                foodValue = typedText;
            }
        }

        const newEntry = { food: foodValue, amount: amount };
        const comment = commentInput.value.trim();
        if (comment) newEntry.comment = comment;

        const nutrition = {};
        for (const [key, inp] of Object.entries(nutritionInputs)) {
            const val = parseFloat(inp.value);
            if (!isNaN(val)) nutrition[key] = val;
        }
        if (Object.keys(nutrition).length > 0) newEntry.nutrition = nutrition;

        mealsState.pendingFoodText = "";
        entries.push(newEntry);
        await rebuildTable();
        persistMeals();

        // rebuildTable() rebuilt the whole row, including a fresh input, so the
        // old `foodInput` reference is detached — look up the new one to refocus
        // it, letting <food><enter> be repeated to add several foods in a row.
        const newFoodInput = outputArea.querySelector(".meals-add-food-input");
        if (newFoodInput) newFoodInput.focus();
    }

    addButton.addEventListener("click", handleAddFood);
    const enterToAdd = (e) => { if (e.key === "Enter") handleAddFood(); };
    foodInput.addEventListener("keydown", (e) => { if (!addFoodLinkSuggest.isOpen()) enterToAdd(e); });
    commentInput.addEventListener("keydown", enterToAdd);
    amountInput.addEventListener("keydown", enterToAdd);
    for (const inp of [...Object.values(nutritionInputs), ...mirroredNutritionInputs]) {
        inp.addEventListener("keydown", enterToAdd);
    }
    }

    await rebuildTable();
}

// Initial render
renderMealsTable(selectedDate);
