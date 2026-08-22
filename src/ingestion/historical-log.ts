export type HistoricalLogBlock = {
  index: number;
  occurredAt: string;
  text: string;
};

const BLOCK_HEADER = /^\[(\d{2}):(\d{2}), (\d{2})\/(\d{2})\/(\d{4})\] [^:]+:\s*/gm;

export function splitHistoricalLog(text: string): HistoricalLogBlock[] {
  const matches = [...text.matchAll(BLOCK_HEADER)];
  if (matches.length < 2) return [];

  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const [, hour, minute, day, month, year] = match;
    return {
      index,
      occurredAt: `${year}-${month}-${day}T${hour}:${minute}:00-03:00`,
      text: text.slice(start, end).trim(),
    };
  });
}
