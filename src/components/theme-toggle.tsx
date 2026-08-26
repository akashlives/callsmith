"use client";

import { Moon, Sun } from "lucide-react";

const THEME_KEY = "callsmith-theme";

export function ThemeToggle() {
  function toggleTheme() {
    const root = document.documentElement;
    const current = root.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    root.style.colorScheme = next;
    window.localStorage.setItem(THEME_KEY, next);
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      <Sun className="theme-toggle__sun" size={17} aria-hidden="true" />
      <Moon className="theme-toggle__moon" size={17} aria-hidden="true" />
    </button>
  );
}
