```dataviewjs
// 1. Create a container for our UI
const wrapper = dv.el("div", "");
wrapper.style.display = "flex";
wrapper.style.flexDirection = "column";
wrapper.style.gap = "15px";

// 2. Create the Date Picker
const dateInput = document.createElement("input");
dateInput.type = "date";
dateInput.style.padding = "5px";
dateInput.style.width = "fit-content";
dateInput.style.background = "var(--background-modifier-form-field)";
dateInput.style.color = "var(--text-normal)";
dateInput.style.border = "1px solid var(--background-modifier-border)";
dateInput.style.borderRadius = "4px";

dateInput.value = moment().format("YYYY-MM-DD");
wrapper.appendChild(dateInput);

const outputArea = document.createElement("div");
wrapper.appendChild(outputArea);

// Unit mappings for standard table headers
const unitMapping = {
    calories: "kcal",
    fat: "g",
    carbohydrates: "g",
    carbs: "g",
    protein: "g",
    sodium: "mg",
    cholesterol: "mg",
    sugar: "g",
    sugars: "g",
    fiber: "g",
    potassium: "mg",
    calcium: "mg",
    iron: "mg"
};

// Helper function to find a file in specific directories
function findFoodFile(name) {
    const validExtensions = ["md", "cook"];
    const targetFolders = ["foods", "recipes"];

    // Get all files in the vault
    const files = app.vault.getFiles();

    return files.find(file => {
        // Match filename (without extension)
        if (file.basename !== name) return false;

        // Match allowed extensions
        if (!validExtensions.includes(file.extension)) return false;

        // Check if the file lives anywhere inside the target folders
        return targetFolders.some(folder => file.path.startsWith(`${folder}/`));
    }) || null;
}

// Helper function to parse *all* nutrition keys from raw text
function parseNutritionFromText(content) {
    const nutrition = {};
    
    // Match the nutrition block until the next top-level YAML key or the end of frontmatter
    const nutritionMatch = content.match(/nutrition:\s*\n([\s\S]*?)(?=\n\w+:|\n---|$)/);
    if (!nutritionMatch) return null;
    
    const lines = nutritionMatch[1].split('\n');
    for (let line of lines) {
        const parts = line.split(':');
        if (parts.length < 2) continue;
        
        const key = parts[0].trim();
        const val = parseFloat(parts[1].trim());
        
        if (key && !isNaN(val)) {
            nutrition[key] = val;
        }
    }
    
    return Object.keys(nutrition).length > 0 ? nutrition : null;
}

// Helper function to capitalize headers and append units
function formatHeader(key) {
    let capitalized = key.charAt(0).toUpperCase() + key.slice(1);
    let unit = unitMapping[key.toLowerCase()];
    return unit ? `${capitalized} (${unit})` : capitalized;
}

// 3. Main Function to read the file and render the table
async function renderMealsTable(dateStr) {
    outputArea.innerHTML = ""; 
    
    const folderPath = "daily";
    const filePath = `${folderPath}/${dateStr}.md`;
    const file = app.vault.getAbstractFileByPath(filePath);
    
    if (!file) {
        outputArea.innerHTML = `<em>No daily note found for <strong>${dateStr}</strong> at <code>${filePath}</code>.</em>`;
        return;
    }
    
    const content = await app.vault.read(file);
    const match = content.match(/```meals\n([\s\S]*?)```/);
    
    if (!match) {
        outputArea.innerHTML = `<em>No <code>meals</code> block found in the note for ${dateStr}.</em>`;
        return;
    }
    
    const lines = match[1].trim().split('\n');
    
    let allKeys = new Set();
    let foodsData = [];
    let totals = {};
    let missing = [];
    
    for (let line of lines) {
        if (!line.trim()) continue;
        
        let parts = line.trim().split(' ');
        let servings = parseFloat(parts.pop());
        let foodName = parts.join(' ').replace(/[\[\]]/g, ''); 
        
        // Try Dataview's index first
        let page = dv.page(`"${foodName}"`);
        let nutrition = null;
        
        if (page && page.nutrition) {
            nutrition = {};
            // Dataview parses objects, extract all numeric fields
            for (let k of Object.keys(page.nutrition)) {
                let val = parseFloat(page.nutrition[k]);
                if (!isNaN(val)) nutrition[k] = val;
            }
        } else {
            // Fallback: Manually search
            let foodFile = findFoodFile(foodName);
            if (foodFile) {
                let foodContent = await app.vault.read(foodFile);
                nutrition = parseNutritionFromText(foodContent);
            }
        }
        
        if (nutrition) {
            let foodRow = { name: foodName, servings: servings, nutrients: {} };
            
            for (let [k, v] of Object.entries(nutrition)) {
                // Normalize key to check against serving size variations
                let normKey = k.toLowerCase().replace(/[-_]/g, ' ');
                if (normKey === 'serving size') continue;
                
                allKeys.add(k);
                let calculatedValue = v * servings;
                foodRow.nutrients[k] = calculatedValue;
                totals[k] = (totals[k] || 0) + calculatedValue;
            }
            
            foodsData.push(foodRow);
        } else {
            missing.push(foodName);
        }
    }
    
    // Convert keys to array and sort (prioritizing major macros first)
    const priority = ['calories', 'fat', 'carbohydrates', 'carbs', 'protein'];
    let keyArray = Array.from(allKeys).sort((a, b) => {
        let idxA = priority.indexOf(a.toLowerCase());
        let idxB = priority.indexOf(b.toLowerCase());
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    // 4. Build HTML table
    let thead = `
        <tr class="table-view-tr-header">
            <th>Food</th>
            <th>Servings</th>
            ${keyArray.map(k => `<th>${formatHeader(k)}</th>`).join('')}
        </tr>
    `;

    // Totals Row (Cumulative on top)
    let totalsRow = `
        <tr style="font-weight: bold; background-color: var(--background-secondary);">
            <td>TOTALS</td>
            <td>-</td>
            ${keyArray.map(k => `<td>${(totals[k] || 0).toFixed(1)}</td>`).join('')}
        </tr>
    `;
    
    // Per-food Rows
    let bodyRows = foodsData.map(food => {
        let nutrientCols = keyArray.map(k => `<td>${(food.nutrients[k] || 0).toFixed(1)}</td>`).join('');
        return `<tr>
            <td>${food.name}</td>
            <td>${food.servings}</td>
            ${nutrientCols}
        </tr>`;
    }).join('\n');

    let tableHTML = `
        <div style="overflow-x: auto;">
            <table class="dataview table-view-table" style="width: 100%; white-space: nowrap;">
                <thead>${thead}</thead>
                <tbody>
                    ${totalsRow}
                    ${bodyRows}
                </tbody>
            </table>
        </div>
    `;
    
    if (missing.length > 0) {
        tableHTML += `<br><p style="color: var(--text-error);">⚠️ <strong>Could not find data for:</strong> ${missing.join(", ")}</p>`;
    }
    
    outputArea.innerHTML = tableHTML;
}

// 5. Event Listeners
dateInput.addEventListener("change", (e) => {
    renderMealsTable(e.target.value);
});

// Initial Render
renderMealsTable(dateInput.value);
```

