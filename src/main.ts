import { mount } from "svelte";
import App from "./App.svelte";
import { flashStatus } from "./appState.svelte.js";
import "./app.css";

// An iPad has no console to look at, so an uncaught error says so in the status bar and stays there
// (sticky) — with where it came from, since a silent failure there otherwise just looks like "undo
// does nothing".
function reportError(what: unknown, where = "") {
  const err = what instanceof Error ? what : null;
  const message = err ? `${err.name}: ${err.message}` : String(what);
  const frame = err?.stack?.split("\n").find((l) => l.includes("/")) ?? where;
  flashStatus(`Error — ${message}${frame ? ` (${frame.trim().replace(/^at /, "")})` : ""}`, 0);
}
window.addEventListener("error", (e) =>
  reportError(e.error ?? e.message, `${e.filename.split("/").pop()}:${e.lineno}:${e.colno}`),
);
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));

mount(App, { target: document.getElementById("app")! });
