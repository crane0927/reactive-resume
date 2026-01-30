import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import Cookies from "js-cookie";
import z from "zod";

const themeSchema = z.union([z.literal("light"), z.literal("dark"), z.literal("system")]);

export type Theme = z.infer<typeof themeSchema>;

const storageKey = "theme";
const defaultTheme: Theme = "system";

export const themeMap = {
	light: msg`Light`,
	dark: msg`Dark`,
	system: msg`System`,
} satisfies Record<Theme, MessageDescriptor>;

export function getSystemTheme(): "light" | "dark" {
	if (typeof window === "undefined") return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getResolvedTheme(theme: Theme): "light" | "dark" {
	return theme === "system" ? getSystemTheme() : theme;
}

export function isTheme(theme: string): theme is Theme {
	return themeSchema.safeParse(theme).success;
}

export const getTheme = createIsomorphicFn()
	.client(() => {
		const theme = Cookies.get(storageKey);
		if (!theme || !isTheme(theme)) return defaultTheme;
		return theme;
	})
	.server(async () => {
		const cookieTheme = getCookie(storageKey);
		if (!cookieTheme || !isTheme(cookieTheme)) return defaultTheme;
		return cookieTheme;
	});

export const setThemeServerFn = createServerFn({ method: "POST" })
	.inputValidator(themeSchema)
	.handler(async ({ data }) => {
		setCookie(storageKey, data);
	});
