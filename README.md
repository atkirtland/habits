# Habits and meals for Obsidian

Track habits and meals in daily notes, and copy note properties between notes.

## Setup

1. Install and enable **Dataview** in Obsidian, then enable **JavaScript Queries** in its settings.
2. Copy these files into a folder in your vault, keeping each view's `.js` and `.md` files together.
3. Copy `habit-tracker.example.md` to `habit-tracker.md` and `meals.example.md` to `meals.md`. Set your daily-note and food folders, template path, and habits. Both local configuration notes are ignored by Git; keep your existing copies if you already have a setup.
4. For the habit tracker to create missing daily notes, enable **Templater** and create a template at the configured path. Name daily notes `YYYY-MM-DD.md`.

Open a view note in Reading view or Live Preview to use it.

## Habits

Open `habit-tracker.md`, choose a month, and select the categories to display. Click a checkbox to cycle through blank, true, and false. Right-click a habit cell to edit its value and goal; save with Ctrl+Enter (Cmd+Enter on macOS).

Habits are stored as properties in daily notes. In the example, `practice_minutes: [10, 15]` meets `practice_goal: 20`. Change the example keys to match your own note properties.

## Meals

Open `meals.md`. Choose a date, then add a food using `[[` to search your food notes, or enter a custom food and its nutrients. Food notes can be Markdown or Cooklang files in the configured folders.

Click a food name, servings, or custom nutrition values to edit them. Right-click a row to change its comment or time, or delete it. Drag the handle to reorder meals, or use Alt+Up/Down on a focused row. Nutrient totals update as you edit.

## Transfer properties

Open `property-transfer.md`, choose source and destination notes and a property, then review the preview before transferring. **Replace** overwrites the destination value; **Append** combines lists; **Merge** combines objects, with source values winning conflicts.

## TODO

> [!todo]
> - [x] Save time eaten
> - [x] Rearrange meals in the UI
> - [ ] Meal templates
> - [ ] Meal groups
> - [ ] Allergens
> - [ ] Other APIs, such as FatSecret
> - [ ] Nutrition goals
