/**
 * Convert an HTML email body to readable plain text.
 * Used when an email has no text/plain part so we only have the HTML body.
 */
export function htmlToText(html: string): string {
  return html
    // Remove head, style, and script blocks entirely
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Block-level elements become newlines so paragraphs are readable
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    // Strip all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Collapse runs of spaces/tabs to a single space
    .replace(/[ \t]+/g, ' ')
    // Collapse more than two consecutive blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Returns true if the string contains HTML tags (heuristic). */
export function isHtml(text: string): boolean {
  return /<[a-zA-Z]/.test(text);
}
