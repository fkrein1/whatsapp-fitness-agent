const SAVE_VERB =
  "(?:adiciona|adicione|adicionar|salva|salve|salvar|registra|registre|registrar|anota|anote|anotar|lanca|lancar|inclui|incluir|add|save|log)";

export function hasImmediateMealSaveIntent(text: string | null | undefined) {
  const normalized = normalize(text);
  if (!normalized || startsWithNegation(normalized)) return false;
  return new RegExp(`^${SAVE_VERB}\\b`, "u").test(normalized);
}

export function isBarePendingMealSaveCommand(text: string | null | undefined) {
  const normalized = normalize(text);
  if (!normalized || startsWithNegation(normalized)) return false;
  return new RegExp(
    `^(?:${SAVE_VERB}|pode (?:${SAVE_VERB}))(?: (?:isso|ai|agora|por favor))?$`,
    "u",
  ).test(normalized);
}

function normalize(text: string | null | undefined) {
  return text
    ?.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function startsWithNegation(text: string) {
  return /^(?:nao|nunca)\b/u.test(text);
}
