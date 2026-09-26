```dataviewjs
const config = {
    dailyNotesFolder: "daily",
    mealsProperty: "meals",
    foodFolders: ["foods", "recipes"],
    foodExtensions: ["md", "cook"],
    nutrientPriority: ["calories", "carbohydrates", "fat", "protein"],
    nutrientUnits: {
        calories: "kcal"
    }
};

const folder = dv.current().file.folder;
await dv.view(`${folder}/meals`, config);
```

