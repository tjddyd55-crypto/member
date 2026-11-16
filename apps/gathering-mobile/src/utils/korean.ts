/** Append 로/으로 using the final Hangul syllable (ㄹ takes 로). */
export function withRo(word: string): string {
  const text = word.trim();
  if (!text) return text;
  const syllable = text.charCodeAt(text.length - 1);
  const batchim = (syllable - 0xac00) % 28;
  const hasBatchim = syllable >= 0xac00 && syllable <= 0xd7a3 && batchim !== 0 && batchim !== 8;
  return `${text}${hasBatchim ? '으로' : '로'}`;
}
