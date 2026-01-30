import { useRouter } from "@tanstack/react-router";
import { createContext, type PropsWithChildren, use, useEffect, useState } from "react";
import { getResolvedTheme, getSystemTheme, setThemeServerFn, type Theme } from "@/utils/theme";

type ThemeContextValue = {
	theme: Theme;
	resolvedTheme: "light" | "dark";
	setTheme: (value: Theme, options?: { playSound?: boolean }) => void;
	toggleTheme: (options?: { playSound?: boolean }) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type Props = PropsWithChildren<{ theme: Theme }>;

export function ThemeProvider({ children, theme }: Props) {
	const router = useRouter();
	const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => getResolvedTheme(theme));

	// 监听系统主题变化
	useEffect(() => {
		if (theme !== "system") {
			setResolvedTheme(theme);
			return;
		}

		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

		function handleChange(e: MediaQueryListEvent) {
			const newTheme = e.matches ? "dark" : "light";
			setResolvedTheme(newTheme);
			document.documentElement.classList.toggle("dark", newTheme === "dark");
		}

		// 初始化
		setResolvedTheme(getSystemTheme());
		document.documentElement.classList.toggle("dark", getSystemTheme() === "dark");

		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, [theme]);

	async function setTheme(value: Theme, options: { playSound?: boolean } = {}) {
		const { playSound = true } = options;

		const resolved = getResolvedTheme(value);
		setResolvedTheme(resolved);
		document.documentElement.classList.toggle("dark", resolved === "dark");
		await setThemeServerFn({ data: value });
		router.invalidate();

		if (!playSound) return;

		try {
			const soundClip = resolved === "dark" ? "/sounds/switch-off.mp3" : "/sounds/switch-on.mp3";
			const audio = new Audio(soundClip);
			await audio.play();
		} catch {
			// ignore errors
		}
	}

	function toggleTheme(options: { playSound?: boolean } = {}) {
		// 循环切换: light -> dark -> system -> light
		const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
		setTheme(nextTheme, options);
	}

	return <ThemeContext value={{ theme, resolvedTheme, setTheme, toggleTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
	const value = use(ThemeContext);

	if (!value) throw new Error("useTheme must be used within a ThemeProvider");

	return value;
}
