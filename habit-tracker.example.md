```dataviewjs
const config = {
  dailyNotesFolder: "daily",
  dailyTemplatePath: "templates/daily",
  categories: [
    { id: "goals", label: "Goals", items: [
      { key: "practice_minutes", label: "Practice", statusType: "number-list", goalKey: "practice_goal", goalType: "number", checkRule: "sum-at-least" },
      { key: "project_notes", label: "Project notes", statusType: "text", goalKey: "project_goal", goalType: "text", checkRule: "non-empty" },
    ]},
    { id: "checklist", label: "Checklist", items: [
      { key: "review_done", label: "Daily review", statusType: "boolean" },
    ]},
  ],
};

const folder = dv.current().file.folder;
await dv.view(`${folder}/habit-tracker`, config);
```
