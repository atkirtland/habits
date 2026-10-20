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

// Dataview empties its own render container before executing a refreshed view.
// Keep the interactive widget in a sibling host so that self-triggered refresh
// cannot destroy its DOM before we decide whether it actually needs rebuilding.
let persistentHost = mealsState.liveHost;
if (!persistentHost?.isConnected || persistentHost.parentElement !== dv.container.parentElement) {
    persistentHost = document.createElement("div");
    persistentHost.className = "meals-persistent-host";
    dv.container.before(persistentHost);
    mealsState.liveHost = persistentHost;
}
dv.container.style.display = "none";

// A frontmatter write makes Dataview execute this view again after its index
// catches up. The handlers below have already updated the live table, so during
// that short self-write window reattach the same DOM instead of rebuilding it.
// Besides avoiding a visible flash, this preserves the mobile keyboard, focus,
// and both scroll positions.
const reuseLiveWrapper = mealsState.liveWrapper
    && mealsState.suppressSelfWriteRerenderUntil > Date.now();

if (reuseLiveWrapper) {
    persistentHost.appendChild(mealsState.liveWrapper);
} else {

// 1. Create a container for our UI
// A genuine later refresh replaces the persistent widget with fresh vault data.
mealsState.cleanupSuggestions?.();
persistentHost.innerHTML = "";
const wrapper = document.createElement("div");
wrapper.style.display = "flex";
wrapper.style.flexDirection = "column";
wrapper.style.gap = "15px";
persistentHost.appendChild(wrapper);
mealsState.liveWrapper = wrapper;

// CSS also covers replacement cells created when editing a food name.
const tableStyle = document.createElement("style");
tableStyle.textContent = `
    .meals-table > tbody > tr > td:first-child {
        position: sticky;
        left: 0;
        z-index: 1;
        background: var(--background-primary);
    }
    .meals-table > tbody > tr:hover > td:first-child {
        background: var(--background-primary-alt);
    }
    .meals-table > tbody > tr > td:first-child,
    .meals-table > thead > tr:first-child > th:first-child,
    .meals-table > thead > tr:last-child > td:first-child {
        box-shadow: 1px 0 0 var(--background-modifier-border);
    }
`;
wrapper.appendChild(tableStyle);

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

// Obsidian assumes ".md" for an extensionless link, so "[[recipes/name]]" never
// reaches "recipes/name.cook". Fall back to each configured food extension.
function resolveFoodFile(target, sourcePath) {
    const direct = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    if (direct) return direct;
    for (const ext of mealsConfig.foodExtensions) {
        const candidate = app.metadataCache.getFirstLinkpathDest(`${target}.${ext}`, sourcePath);
        if (candidate) return candidate;
    }
    return null;
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

// Use one controlled popup for both plain names and [[links]]. Native datalist
// popups cannot be positioned around Android's keyboard.
const suggestionCleanups = new Set();
mealsState.cleanupSuggestions = () => {
    for (const cleanup of [...suggestionCleanups]) cleanup();
};

function attachLinkSuggest(inputEl, suggestionsList) {
    inputEl.autocomplete = "off";
    inputEl.spellcheck = false;
    inputEl.setAttribute("autocorrect", "off");
    inputEl.setAttribute("autocapitalize", "off");
    inputEl.setAttribute("role", "combobox");
    inputEl.setAttribute("aria-autocomplete", "list");
    inputEl.setAttribute("aria-expanded", "false");
    const dropdown = document.createElement("div");
    dropdown.id = "meals-suggestions-" + Math.random().toString(36).slice(2);
    dropdown.setAttribute("role", "listbox");
    inputEl.setAttribute("aria-controls", dropdown.id);
    Object.assign(dropdown.style, {
        position: "fixed", zIndex: "200",
        background: "var(--background-primary)",
        border: "1px solid var(--background-modifier-border)",
        borderRadius: "4px", overflowY: "auto", display: "none",
        boxSizing: "border-box", overscrollBehavior: "contain",
        touchAction: "pan-y", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)"
    });
    document.body.appendChild(dropdown);

    let activeIndex = -1;
    let currentMatches = [];
    let linkStart = -1;
    let composing = false;
    let blurTimer;
    let disposed = false;

    function closeDropdown() {
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
        inputEl.setAttribute("aria-expanded", "false");
        inputEl.removeAttribute("aria-activedescendant");
        activeIndex = -1;
        currentMatches = [];
        linkStart = -1;
    }

    function positionDropdown() {
        if (dropdown.style.display === "none") return;
        if (!inputEl.isConnected) {
            cleanup();
            return;
        }
        const rect = inputEl.getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = (viewport?.offsetLeft || 0) + 8;
        const top = (viewport?.offsetTop || 0) + 8;
        const right = left + (viewport?.width || window.innerWidth) - 16;
        const bottom = top + (viewport?.height || window.innerHeight) - 16;
        const below = Math.max(0, bottom - rect.bottom - 4);
        const above = Math.max(0, rect.top - top - 4);
        const placeAbove = below < 160 && above > below;
        const space = placeAbove ? above : below;
        // Do not cover the field if neither side has room for a touch target.
        if (space < 44 || rect.bottom < top || rect.top > bottom
            || rect.right < left || rect.left > right) {
            closeDropdown();
            return;
        }
        const width = Math.min(Math.max(rect.width, 240), right - left);
        dropdown.style.width = width + "px";
        dropdown.style.maxHeight = Math.min(240, space) + "px";
        dropdown.style.left = Math.max(left, Math.min(rect.left, right - width)) + "px";
        dropdown.style.top = (placeAbove
            ? rect.top - 4 - dropdown.getBoundingClientRect().height
            : rect.bottom + 4) + "px";
    }

    function selectMatch(match) {
        const before = linkStart >= 0 ? inputEl.value.slice(0, linkStart) : "";
        const linkText = match.path === match.alias
            ? "[[" + match.path + "]]"
            : "[[" + match.path + "|" + match.alias + "]]";
        inputEl.value = before + linkText;
        closeDropdown();
        clearTimeout(blurTimer);
        inputEl.focus({ preventScroll: true });
        // Keep the add-food draft in sync with programmatic selections.
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function renderDropdown() {
        dropdown.innerHTML = "";
        if (currentMatches.length === 0) {
            closeDropdown();
            return;
        }
        currentMatches.forEach((match, index) => {
            const item = document.createElement("div");
            item.id = dropdown.id + "-" + index;
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", String(index === activeIndex));
            item.textContent = match.alias;
            Object.assign(item.style, {
                padding: "10px 12px", minHeight: "44px", boxSizing: "border-box",
                whiteSpace: "normal", overflowWrap: "anywhere", cursor: "pointer",
                backgroundColor: index === activeIndex ? "var(--background-modifier-hover)" : ""
            });
            // Keep focus/keyboard on the input; select on click so swiping the
            // list does not accidentally choose the first item touched.
            item.addEventListener("pointerdown", event => event.preventDefault());
            item.addEventListener("click", () => selectMatch(match));
            dropdown.appendChild(item);
        });
        dropdown.style.display = "block";
        inputEl.setAttribute("aria-expanded", "true");
        inputEl.setAttribute("aria-activedescendant", dropdown.id + "-" + activeIndex);
        positionDropdown();
        const active = dropdown.children[activeIndex];
        if (active) dropdown.scrollTop = Math.max(0, active.offsetTop - dropdown.clientHeight + active.offsetHeight);
    }

    function updateMatches() {
        if (disposed || composing) return;
        const value = inputEl.value;
        const index = value.lastIndexOf("[[");
        const query = index >= 0 ? value.slice(index + 2) : value.trim();
        if ((index < 0 && !query) || query.includes("]]")) {
            closeDropdown();
            return;
        }
        linkStart = index;
        currentMatches = suggestionsList
            .map(s => ({ s, score: fuzzyScore(query, s.alias) }))
            .filter(m => m.score !== null)
            .sort((a, b) => a.score - b.score)
            .slice(0, 20)
            .map(m => m.s);
        activeIndex = currentMatches.length > 0 ? 0 : -1;
        renderDropdown();
    }

    inputEl.addEventListener("input", updateMatches);
    inputEl.addEventListener("compositionstart", () => {
        composing = true;
        closeDropdown();
    });
    inputEl.addEventListener("compositionend", () => {
        composing = false;
        updateMatches();
    });
    inputEl.addEventListener("keydown", event => {
        if (composing || event.isComposing || event.keyCode === 229) {
            event.stopImmediatePropagation();
            return;
        }
        if (dropdown.style.display === "none") return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopImmediatePropagation();
            activeIndex = Math.max(0, Math.min(currentMatches.length - 1,
                activeIndex + (event.key === "ArrowDown" ? 1 : -1)));
            renderDropdown();
        } else if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            event.stopImmediatePropagation();
            selectMatch(currentMatches[activeIndex]);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeDropdown();
        }
    });
    inputEl.addEventListener("blur", () => {
        blurTimer = setTimeout(closeDropdown, 150);
    });
    function onScroll(event) {
        if (!(event.target instanceof Node) || !dropdown.contains(event.target)) positionDropdown();
    }
    const viewport = window.visualViewport;
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", positionDropdown);
    viewport?.addEventListener("resize", positionDropdown);
    viewport?.addEventListener("scroll", positionDropdown);
    function cleanup() {
        disposed = true;
        clearTimeout(blurTimer);
        dropdown.remove();
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", positionDropdown);
        viewport?.removeEventListener("resize", positionDropdown);
        viewport?.removeEventListener("scroll", positionDropdown);
        suggestionCleanups.delete(cleanup);
    }
    suggestionCleanups.add(cleanup);
    return { isOpen: () => dropdown.style.display !== "none", cleanup };
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
    mealsState.cleanupSuggestions();
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

    // Persists the current in-memory `entries` to disk. Dataview notices the file
    // change itself; explicitly requesting a vault-wide refresh here caused an
    // additional delayed rebuild of this very table.
    async function persistMeals() {
        // Keep optional comments and consumption times out of YAML unless they
        // contain visible text.
        for (const entry of entries) {
            if (typeof entry.comment === "string") {
                entry.comment = entry.comment.trim();
                if (!entry.comment) delete entry.comment;
            } else if (entry.comment != null) {
                entry.comment = String(entry.comment).trim();
                if (!entry.comment) delete entry.comment;
            }
            if (typeof entry.time === "string") {
                entry.time = entry.time.trim();
                if (!entry.time) delete entry.time;
            } else if (entry.time != null) {
                entry.time = String(entry.time).trim();
                if (!entry.time) delete entry.time;
            }
        }
        // Dataview's metadata refresh is asynchronous and can arrive several
        // seconds after this write completes.
        mealsState.suppressSelfWriteRerenderUntil = Date.now() + 15000;
        try {
            await app.fileManager.processFrontMatter(file, (fm) => {
                fm[mealsConfig.mealsProperty] = entries;
            });
        } catch (error) {
            mealsState.suppressSelfWriteRerenderUntil = 0;
            throw error;
        }
    }

    async function rebuildTable() {
    mealsState.cleanupSuggestions();
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
            const targetFile = resolveFoodFile(target, file.path);
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
            time: entry.time == null ? "" : String(entry.time),
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
    table.className = "dataview table-view-table meals-table";
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
    for (const group of ["carbohydrates", "fats", "vitamins", "minerals", "other"]) appendGroupHeader(group);
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

    // Capture the entry itself so actions survive table rebuilds.
    function attachMealMenu(row, entry, isDraft = false) {
        row.tabIndex = 0;
        row.setAttribute("aria-label", isDraft
            ? "Add food; right-click for comment and time"
            : "Meal row; right-click for comment, time, and delete");

        function editField(key, label) {
            const modal = document.createElement("dialog");
            Object.assign(modal.style, {
                width: "min(420px, calc(100vw - 40px))", padding: "20px",
                border: "1px solid var(--background-modifier-border)", borderRadius: "8px",
                color: "var(--text-normal)", background: "var(--background-primary)"
            });
            const heading = document.createElement("h2");
            heading.textContent = label;
            modal.appendChild(heading);
            modal.setAttribute("aria-label", label);
            modal.addEventListener("close", () => modal.remove(), { once: true });
            const form = document.createElement("form");
            const field = document.createElement("input");
            field.type = key === "time" ? "time" : "text";
            field.value = entry[key] == null ? "" : String(entry[key]);
            field.setAttribute("aria-label", label);
            field.style.width = "100%";
            styleInput(field);
            form.appendChild(field);
            const hint = document.createElement("p");
            hint.textContent = "Leave blank to clear this value.";
            form.appendChild(hint);
            const save = document.createElement("button");
            save.type = "submit";
            save.textContent = "Save";
            save.className = "mod-cta";
            form.appendChild(save);
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", () => modal.close());
            form.appendChild(cancel);
            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!isDraft && !entries.includes(entry)) {
                    modal.close();
                    return;
                }
                const value = field.value.trim();
                if (value) entry[key] = value;
                else delete entry[key];
                modal.close();
                if (!isDraft) {
                    await rebuildTable();
                    await persistMeals();
                }
            });
            modal.appendChild(form);
            document.body.appendChild(modal);
            modal.showModal();
            field.focus();
        }

        function showMenu(position) {
            const menu = document.createElement("dialog");
            menu.setAttribute("role", "menu");
            menu.setAttribute("aria-label", "Meal actions");
            Object.assign(menu.style, {
                position: "fixed", margin: "0", padding: "4px",
                maxWidth: "min(420px, calc(100vw - 16px))",
                border: "1px solid var(--background-modifier-border)", borderRadius: "6px",
                color: "var(--text-normal)", background: "var(--background-primary)",
                boxShadow: "0 2px 12px rgba(0,0,0,.3)"
            });
            function addAction(label, action, destructive = false) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                button.setAttribute("role", "menuitem");
                Object.assign(button.style, {
                    display: "block", width: "100%", textAlign: "left",
                    whiteSpace: "normal", height: "auto", padding: "8px 12px",
                    boxShadow: "none", border: "0"
                });
                if (destructive) button.style.color = "var(--text-error)";
                button.addEventListener("click", () => {
                    menu.close();
                    action();
                });
                menu.appendChild(button);
            }
            addAction(entry.comment ? "Comment: " + entry.comment : "Add comment…",
                () => editField("comment", "Edit comment"));
            addAction(entry.time ? "Time: " + entry.time : "Set time…",
                () => editField("time", "Time of consumption"));
            if (!isDraft) {
                addAction("Delete meal", async () => {
                    const index = entries.indexOf(entry);
                    if (index === -1) return;
                    entries.splice(index, 1);
                    await rebuildTable();
                    await persistMeals();
                }, true);
            }
            menu.addEventListener("close", () => menu.remove(), { once: true });
            menu.addEventListener("click", event => {
                if (event.target === menu) menu.close();
            });
            menu.addEventListener("contextmenu", event => {
                event.preventDefault();
                menu.close();
            });
            menu.addEventListener("keydown", event => {
                const buttons = Array.from(menu.querySelectorAll("button"));
                const index = buttons.indexOf(document.activeElement);
                let next;
                if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
                if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
                if (event.key === "Home") next = 0;
                if (event.key === "End") next = buttons.length - 1;
                if (next !== undefined) {
                    event.preventDefault();
                    buttons[next].focus();
                }
            });
            document.body.appendChild(menu);
            menu.showModal();
            const rect = menu.getBoundingClientRect();
            menu.style.left = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)) + "px";
            menu.style.top = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)) + "px";
        }

        row.addEventListener("contextmenu", event => {
            event.preventDefault();
            event.stopPropagation();
            showMenu({ x: event.clientX, y: event.clientY });
        });
        row.addEventListener("keydown", event => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = row.getBoundingClientRect();
            showMenu({ x: rect.left, y: rect.bottom });
        });
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
                    if (inp.isConnected && document.activeElement !== inp && !linkSuggest.isOpen()) saveFoodEdit();
                }, 200);
            });
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
        attachMealMenu(tr, entries[entryIndex]);
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
        attachMealMenu(tr, entries[entryIndex]);
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

        let editFinished = false;
        async function saveEdit() {
            if (editFinished || !tr.isConnected) return;
            editFinished = true;
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

    const draftMetadata = {};
    attachMealMenu(addRow, draftMetadata, true);

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
        // These intersections stick in both directions and cover the other
        // cells in their header tier during horizontal scrolling.
        headerRow.cells[0].style.left = "0px";
        headerRow.cells[0].style.zIndex = "14";
        totalsRow.cells[0].style.left = "0px";
        totalsRow.cells[0].style.zIndex = "12";
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

        const newEntry = { food: foodValue, amount: amount, ...draftMetadata };

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
    amountInput.addEventListener("keydown", enterToAdd);
    for (const inp of [...Object.values(nutritionInputs), ...mirroredNutritionInputs]) {
        inp.addEventListener("keydown", enterToAdd);
    }
    }

    await rebuildTable();
}

// Initial render
renderMealsTable(selectedDate);
}
