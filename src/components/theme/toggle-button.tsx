import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/utils/theme";
import { useTheme } from "./provider";

export function ThemeToggleButton(props: React.ComponentProps<typeof Button>) {
	const { theme, resolvedTheme, setTheme } = useTheme();
	const buttonRef = useRef<HTMLButtonElement>(null);

	const onSetTheme = useCallback(
		async (newTheme: Theme) => {
			if (
				!buttonRef.current ||
				!document.startViewTransition ||
				window.matchMedia("(prefers-reduced-motion: reduce)").matches
			) {
				setTheme(newTheme);
				return;
			}

			let timeout: NodeJS.Timeout;
			const style = document.createElement("style");

			style.textContent = `
			::view-transition-old(root), ::view-transition-new(root) {
				mix-blend-mode: normal !important;
				animation: none !important;
			}
		`;

			function transitionCallback() {
				flushSync(() => {
					setTheme(newTheme);
					timeout = setTimeout(() => {
						clearTimeout(timeout);
						document.head.removeChild(style);
					}, 1000);
				});
			}

			document.head.appendChild(style);
			await document.startViewTransition(transitionCallback).ready;

			const { top, left, width, height } = buttonRef.current.getBoundingClientRect();
			const x = left + width / 2;
			const y = top + height / 2;
			const right = window.innerWidth - left;
			const bottom = window.innerHeight - top;
			const maxRadius = Math.hypot(Math.max(left, right), Math.max(top, bottom));

			document.documentElement.animate(
				{ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxRadius}px at ${x}px ${y}px)`] },
				{ duration: 500, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" },
			);
		},
		[setTheme],
	);

	const ariaLabel = t`Switch theme`;

	const ThemeIcon = theme === "system" ? DesktopIcon : resolvedTheme === "dark" ? MoonIcon : SunIcon;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size="icon" variant="ghost" ref={buttonRef} aria-label={ariaLabel} {...props}>
					<ThemeIcon aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuRadioGroup value={theme} onValueChange={(value) => onSetTheme(value as Theme)}>
					<DropdownMenuRadioItem value="light">
						<SunIcon className="mr-2" />
						<Trans>Light</Trans>
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="dark">
						<MoonIcon className="mr-2" />
						<Trans>Dark</Trans>
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="system">
						<DesktopIcon className="mr-2" />
						<Trans>System</Trans>
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
