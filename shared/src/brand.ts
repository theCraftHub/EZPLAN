/**
 * The single place the product's name and identity live.
 *
 * "EZPLAN" is an internal working codename: a direct competitor uses that name,
 * so the product will be renamed in the Branding phase. Renaming = editing this
 * file (plus mockups and docs). No other source file may contain the brand name;
 * a test enforces that.
 */
export const BRAND = {
  /** Shown to people: app title, emails, exports, prompts. */
  name: "EZPLAN",
  /** True while the name is a placeholder; UI can show a "working name" badge. */
  isCodename: true,
  /** Header key written into plan files (`<key>: 1`). */
  formatKey: "ezplan",
  /** File extensions written on export; the first is the default. */
  fileExtensions: [".ezplan", ".ezplan.md"],
  /** Public website and email domain; none until the Branding phase. */
  domain: null as string | null,
  supportEmail: null as string | null,
  securityEmail: null as string | null,
  colors: { primary: "#4F46E5", ink: "#0F172A", ground: "#F6F7F9" },
} as const;

/**
 * Every format header key ever used. Files written under an old name must keep
 * importing after a rename, so when the brand changes, add the new key here and
 * never remove old ones.
 */
export const FORMAT_KEYS: readonly string[] = ["ezplan"];

/** Every file extension ever used, for imports and "open with" registration. */
export const FILE_EXTENSIONS: readonly string[] = [".ezplan", ".ezplan.md"];
