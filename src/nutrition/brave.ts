import type { AppBindings } from "../env";

export type NutritionSearchResult = {
  query: string;
  title: string;
  url: string;
  description: string;
};

type BraveSearchResponse = {
  web?: {
    results?: Array<{ title?: string; url?: string; description?: string }>;
  };
};

export async function searchNutrition(
  queries: string[],
  env: AppBindings,
): Promise<NutritionSearchResult[]> {
  const batches = await Promise.all(
    queries.slice(0, 3).map(async (query) => {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("country", "BR");
      url.searchParams.set("search_lang", "pt-br");
      url.searchParams.set("ui_lang", "pt-BR");
      url.searchParams.set("count", "5");
      url.searchParams.set("safesearch", "moderate");

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
        },
      });
      if (!response.ok) throw new Error(`Brave Search request failed (${response.status})`);

      const body = (await response.json()) as BraveSearchResponse;
      return (body.web?.results ?? [])
        .filter((result): result is { title: string; url: string; description: string } =>
          Boolean(result.title && result.url && result.description),
        )
        .slice(0, 3)
        .map((result) => ({ query, ...result }));
    }),
  );

  return batches.flat();
}

export function formatNutritionResearch(results: NutritionSearchResult[]) {
  if (!results.length) return null;
  return results
    .map(
      (result, index) =>
        `[${index + 1}] Query: ${result.query}\nTitle: ${result.title}\nURL: ${result.url}\nSnippet: ${result.description}`,
    )
    .join("\n\n");
}
