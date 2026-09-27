const transferInput = input || {};
const transferConfig = {
    sourceNote: "",
    destinationNote: "",
    propertyName: "",
    operation: "replace",
    noteFolders: [],
    ...transferInput
};

const root = dv.container;
root.innerHTML = "";

const panel = document.createElement("div");
panel.style.display = "grid";
panel.style.gap = "10px";
panel.style.maxWidth = "720px";
root.appendChild(panel);

const noteFiles = app.vault.getMarkdownFiles()
    .filter(file => transferConfig.noteFolders.length === 0
        || transferConfig.noteFolders.some(folder =>
            file.path === folder || file.path.startsWith(`${folder.replace(/\/$/, "")}/`)))
    .sort((a, b) => a.path.localeCompare(b.path));

const notesList = document.createElement("datalist");
notesList.id = `property-transfer-notes-${Math.random().toString(36).slice(2)}`;
for (const file of noteFiles) {
    const option = document.createElement("option");
    option.value = file.path.replace(/\.md$/i, "");
    notesList.appendChild(option);
}
panel.appendChild(notesList);

const propertiesList = document.createElement("datalist");
propertiesList.id = `property-transfer-properties-${Math.random().toString(36).slice(2)}`;
panel.appendChild(propertiesList);

function makeField(labelText, control) {
    const label = document.createElement("label");
    label.style.display = "grid";
    label.style.gap = "4px";

    const caption = document.createElement("span");
    caption.textContent = labelText;
    caption.style.fontSize = "0.85em";
    caption.style.color = "var(--text-muted)";

    control.style.width = "100%";
    control.style.boxSizing = "border-box";
    label.append(caption, control);
    panel.appendChild(label);
    return control;
}

function makeTextInput(value, placeholder) {
    const element = document.createElement("input");
    element.type = "text";
    element.value = value || "";
    element.placeholder = placeholder;
    return element;
}

const sourceInput = makeField("Source note", makeTextInput(transferConfig.sourceNote, "folder/note"));
sourceInput.setAttribute("list", notesList.id);

const destinationInput = makeField(
    "Destination note",
    makeTextInput(transferConfig.destinationNote, "folder/note")
);
destinationInput.setAttribute("list", notesList.id);

const propertyInput = makeField(
    "Property",
    makeTextInput(transferConfig.propertyName, "property name")
);
propertyInput.setAttribute("list", propertiesList.id);

const operationSelect = document.createElement("select");
for (const [value, label] of [
    ["replace", "Replace destination value"],
    ["append", "Append lists"],
    ["merge", "Merge objects"]
]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = transferConfig.operation === value;
    operationSelect.appendChild(option);
}
makeField("Operation", operationSelect);

const preview = document.createElement("pre");
preview.style.margin = "0";
preview.style.padding = "10px";
preview.style.maxHeight = "260px";
preview.style.overflow = "auto";
preview.style.whiteSpace = "pre-wrap";
preview.style.overflowWrap = "anywhere";
preview.style.background = "var(--background-secondary)";
preview.style.borderRadius = "6px";
preview.textContent = "Choose a source note and property to preview its value.";
panel.appendChild(preview);

const controls = document.createElement("div");
controls.style.display = "flex";
controls.style.alignItems = "center";
controls.style.gap = "10px";

const transferButton = document.createElement("button");
transferButton.textContent = "Transfer property";
const status = document.createElement("span");
status.style.fontSize = "0.85em";
status.style.color = "var(--text-muted)";
controls.append(transferButton, status);
panel.appendChild(controls);

function normalizeNotePath(value) {
    let path = String(value || "").trim();
    const wikilink = path.match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/);
    if (wikilink) path = wikilink[1];
    return path.replace(/\.md$/i, "");
}

function resolveNote(value) {
    const path = normalizeNotePath(value);
    if (!path) return null;
    return app.metadataCache.getFirstLinkpathDest(path, dv.current().file.path);
}

function frontmatterFor(file) {
    return file ? app.metadataCache.getFileCache(file)?.frontmatter : null;
}

function propertyKeys(frontmatter) {
    return Object.keys(frontmatter || {}).filter(key => key !== "position").sort();
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function cloneValue(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(cloneValue);
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
    }
    return value;
}

function deepMerge(destination, source) {
    const result = cloneValue(destination);
    for (const [key, value] of Object.entries(source)) {
        result[key] = isPlainObject(result[key]) && isPlainObject(value)
            ? deepMerge(result[key], value)
            : cloneValue(value);
    }
    return result;
}

function describe(value) {
    if (Array.isArray(value)) return `list with ${value.length} item${value.length === 1 ? "" : "s"}`;
    if (isPlainObject(value)) return `object with ${Object.keys(value).length} key${Object.keys(value).length === 1 ? "" : "s"}`;
    if (value === null) return "null";
    return typeof value;
}

function printable(value) {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch (_) {
        return String(value);
    }
}

function refreshPropertySuggestions() {
    propertiesList.innerHTML = "";
    const sourceFile = resolveNote(sourceInput.value);
    for (const key of propertyKeys(frontmatterFor(sourceFile))) {
        const option = document.createElement("option");
        option.value = key;
        propertiesList.appendChild(option);
    }
}

function validate() {
    const sourceFile = resolveNote(sourceInput.value);
    const destinationFile = resolveNote(destinationInput.value);
    const propertyName = propertyInput.value.trim();

    if (!sourceFile) throw new Error("Choose an existing source note.");
    if (!destinationFile) throw new Error("Choose an existing destination note.");
    if (sourceFile.path === destinationFile.path) throw new Error("Source and destination must be different notes.");
    if (!propertyName) throw new Error("Enter a property name.");

    const sourceFrontmatter = frontmatterFor(sourceFile);
    if (!hasOwn(sourceFrontmatter, propertyName)) {
        throw new Error(`The source note has no “${propertyName}” property.`);
    }

    const sourceValue = sourceFrontmatter[propertyName];
    const destinationFrontmatter = frontmatterFor(destinationFile) || {};
    const destinationHasValue = hasOwn(destinationFrontmatter, propertyName);
    const destinationValue = destinationFrontmatter[propertyName];
    const operation = operationSelect.value;

    if (operation === "append" && !Array.isArray(sourceValue)) {
        throw new Error("Append requires the source property to be a list.");
    }
    if (operation === "append" && destinationHasValue && !Array.isArray(destinationValue)) {
        throw new Error("Append requires the destination property to be a list or absent.");
    }
    if (operation === "merge" && !isPlainObject(sourceValue)) {
        throw new Error("Merge requires the source property to be an object.");
    }
    if (operation === "merge" && destinationHasValue && !isPlainObject(destinationValue)) {
        throw new Error("Merge requires the destination property to be an object or absent.");
    }

    let result;
    if (operation === "append") {
        result = [...(destinationHasValue ? cloneValue(destinationValue) : []), ...cloneValue(sourceValue)];
    } else if (operation === "merge") {
        result = deepMerge(destinationHasValue ? destinationValue : {}, sourceValue);
    } else {
        result = cloneValue(sourceValue);
    }

    return {
        sourceFile,
        destinationFile,
        propertyName,
        sourceValue,
        destinationHasValue,
        result,
        operation
    };
}

function refreshPreview() {
    status.textContent = "";
    try {
        const details = validate();
        const verb = details.operation === "replace"
            ? (details.destinationHasValue ? "replace" : "create")
            : details.operation;
        preview.textContent = [
            `${details.sourceFile.path}: ${describe(details.sourceValue)}`,
            `Will ${verb} “${details.propertyName}” in ${details.destinationFile.path}.`,
            "",
            printable(details.result)
        ].join("\n");
        transferButton.disabled = false;
    } catch (error) {
        preview.textContent = error.message;
        transferButton.disabled = true;
    }
}

sourceInput.addEventListener("input", () => {
    refreshPropertySuggestions();
    refreshPreview();
});
for (const control of [destinationInput, propertyInput, operationSelect]) {
    control.addEventListener("input", refreshPreview);
    control.addEventListener("change", refreshPreview);
}

transferButton.addEventListener("click", async () => {
    transferButton.disabled = true;
    status.textContent = "Writing…";
    try {
        const details = validate();
        await app.fileManager.processFrontMatter(details.destinationFile, frontmatter => {
            frontmatter[details.propertyName] = cloneValue(details.result);
        });
        app.workspace.trigger("dataview:refresh-views");
        refreshPreview();
        status.textContent = `Transferred to ${details.destinationFile.basename}.`;
    } catch (error) {
        status.textContent = error.message;
        transferButton.disabled = false;
    }
});

refreshPropertySuggestions();
refreshPreview();
