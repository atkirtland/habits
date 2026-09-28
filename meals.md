```dataviewjs
const config = {
    dailyNotesFolder: "daily",
    mealsProperty: "meals",
    foodFolders: ["foods", "recipes"],
    foodExtensions: ["md", "cook"],
    nutrientPriority: ["calories", "carbohydrates", "fat", "protein", "sodium", "potassium"],
    nutrientUnits: {
        calories: "kcal"
    }
};

const folder = dv.current().file.folder;
await dv.view(`${folder}/meals`, config);
```

Right-click a meal row to edit its comment or consumption time, or delete it.
Right-click the add-food row to set a comment or time before adding. Clear a value in its dialog to remove it.

