```dataviewjs
const config = {
    // Optional defaults. Note paths may omit the final ".md".
    sourceNote: "",
    destinationNote: "",
    propertyName: "",
    operation: "replace",

    // Leave empty to autocomplete every Markdown note in the vault.
    // Example: ["daily"]
    noteFolders: []
};

const folder = dv.current().file.folder;
await dv.view(`${folder}/property-transfer`, config);
```

The transfer operates on parsed frontmatter rather than copied text. **Replace**
works with any property type, **Append** combines lists, and **Merge** recursively
combines objects. In a merge, values from the source note win when both notes
contain the same key.
