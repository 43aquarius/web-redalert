// Minimal INI parser (RA2 format: sections, comments ;, key=value)
export class IniParser {
  private src: string;
  constructor(src: string) { this.src = src; }
  parse(): { sections: Record<string, Record<string, string>> } {
    const sections: Record<string, Record<string, string>> = {};
    let current: Record<string, string> | null = null;
    let currentName = '';
    for (let line of this.src.split('\r\n').join('\n').split('\n')) {
      // strip comments (but keep semicolons inside quotes... RA2 uses ; comments)
      const commentIdx = line.indexOf(';');
      if (commentIdx >= 0) line = line.slice(0, commentIdx);
      line = line.trim();
      if (!line) continue;
      const secMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (secMatch) {
        currentName = secMatch[1].trim();
        current = sections[currentName] ??= {};
        continue;
      }
      const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (kv && current) {
        current[kv[1].trim()] = kv[2].trim();
      }
    }
    return { sections };
  }
}
