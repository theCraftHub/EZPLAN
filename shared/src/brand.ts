/**
 * The single place the product's name and identity live.
 *
 * Rakuplan ("raku" is Japanese for easy). Renaming = editing this file (plus
 * mockups and docs). No other source file may contain the brand name; a test
 * enforces that.
 */
export const BRAND = {
  /** Shown to people: app title, emails, exports, prompts. */
  name: "Rakuplan",
  /** True while the name is a placeholder; UI can show a "working name" badge. */
  isCodename: false,
  /** Header key written into plan files (`<key>: 1`). */
  formatKey: "rakuplan",
  /** File extensions written on export; the first is the default. */
  fileExtensions: [".rakuplan", ".rakuplan.md"],
  /** Public website and email domain. */
  domain: "rakuplan.com" as string | null,
  supportEmail: "support@rakuplan.com" as string | null,
  securityEmail: "security@rakuplan.com" as string | null,
  colors: { primary: "#4F46E5", ink: "#0F172A", ground: "#F6F7F9" },
} as const;

/**
 * Every format header key ever used. Files written under an old name must keep
 * importing after a rename, so when the brand changes, add the new key here and
 * never remove old ones.
 */
export const FORMAT_KEYS: readonly string[] = ["rakuplan"];

/** Every file extension ever used, for imports and "open with" registration. */
export const FILE_EXTENSIONS: readonly string[] = [".rakuplan", ".rakuplan.md"];
