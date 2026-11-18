/**
 * Copies text to the clipboard. Tries the async Clipboard API; when it is
 * missing or refuses (insecure context, permissions), falls back to a hidden
 * textarea and `document.execCommand("copy")`. Resolves true when either
 * worked. Client-only.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea path
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.setAttribute("aria-hidden", "true")
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
