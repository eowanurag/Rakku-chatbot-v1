"use client";

import React, { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    // Access document only on client mount
    const savedTheme = localStorage.getItem("theme") as "dark" | "light" | null;
    const isLight = savedTheme === "light" || (!savedTheme && document.documentElement.classList.contains("theme-light"));
    
    if (isLight) {
      setTheme("light");
      document.documentElement.classList.add("theme-light");
      document.documentElement.classList.remove("dark");
    } else {
      setTheme("dark");
      document.documentElement.classList.remove("theme-light");
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleTheme = () => {
    if (theme === "dark") {
      setTheme("light");
      document.documentElement.classList.add("theme-light");
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    } else {
      setTheme("dark");
      document.documentElement.classList.remove("theme-light");
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
  };

  return (
    <button
      onClick={toggleTheme}
      className="p-2.5 rounded-lg border border-slate-700/80 bg-slate-800/40 hover:bg-slate-800 text-slate-300 hover:text-police-gold transition-all duration-200 focus:outline-none flex items-center justify-center shadow-sm"
      aria-label="Toggle Theme"
      title={theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme"}
    >
      {theme === "dark" ? (
        <Sun className="w-4.5 h-4.5 text-police-gold" />
      ) : (
        <Moon className="w-4.5 h-4.5 text-police-navy" />
      )}
    </button>
  );
}
