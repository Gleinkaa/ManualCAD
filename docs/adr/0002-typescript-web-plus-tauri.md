# TypeScript web app, packaged with Tauri for Windows and Linux

ManualCAD is a TypeScript browser app that draws on Canvas2D, and the same code is wrapped with Tauri as a desktop app for Windows and Linux. 2D drawings don't need a GPU pipeline or a C++ kernel. One codebase covers browser and desktop on both operating systems, and if coordinates are stored in float64 relative to each view's origin, the float32 precision problems from the research document never come up.

## Considered Options

- Native C++/Qt: desktop only, much slower to build.
- Electron: larger and heavier than Tauri, with no benefit for this app.
