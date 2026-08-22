import { afterEach, describe, expect, it, vi } from "vitest";

import { formatNutritionResearch, searchNutrition } from "../src/nutrition/brave";

describe("Brave nutrition search", () => {
  afterEach(() => vi.restoreAllMocks());

  it("targets Brazilian Portuguese results and returns compact evidence", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        web: {
          results: [
            {
              title: "Informação nutricional",
              url: "https://example.com/product",
              description: "Uma porção contém 100 kcal.",
            },
          ],
        },
      }),
    );

    const results = await searchNutrition(["produto calorias"], {
      BRAVE_SEARCH_API_KEY: "test-key",
    } as Env);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toContain("country=BR");
    expect(String(requestUrl)).toContain("search_lang=pt-br");
    expect(requestInit?.headers).toMatchObject({ "X-Subscription-Token": "test-key" });
    expect(formatNutritionResearch(results)).toContain("https://example.com/product");
  });

  it("rejects an unsuccessful API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("limited", { status: 429 }));

    await expect(
      searchNutrition(["produto calorias"], { BRAVE_SEARCH_API_KEY: "test-key" } as Env),
    ).rejects.toThrow("Brave Search request failed (429)");
  });
});
