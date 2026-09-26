```dataviewjs
const config = {
    dailyNotesFolder: "daily",
    mealsProperty: "meals",
    foodFolders: ["foods", "recipes"],
    foodExtensions: ["md", "cook"],
    nutrientPriority: ["calories", "carbohydrates", "fat", "protein"],
    nutrientUnits: {
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
        iron: "mg"
    }
};

const folder = dv.current().file.folder;
await dv.view(`${folder}/meals`, config);
```

