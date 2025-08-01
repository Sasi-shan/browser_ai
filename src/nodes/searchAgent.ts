import { Stagehand } from "@browserbasehq/stagehand";
import { AgentState } from "../graph";

export async function searchAgent(state: AgentState): Promise<Partial<AgentState>> {
  console.log("---");
  console.log("Executing Search Agent");
  console.log(`Searching for: "${state.query}"`);

  const stagehand = new Stagehand();
  try {
    const { page, browser } = await stagehand.init({ local: true });

    await page.goto("https://duckduckgo.com/");
    await stagehand.assist("Type the search query into the search bar and press Enter", {
      page,
      data: { query: state.query },
    });

    // Best Practice: Avoid broad instructions. Be specific.
    const searchResults = await stagehand.get("a list of the search result URLs, specifically the 'href' attributes of the main result links", {
      page,
      // We use Zod to define the expected structure, ensuring type safety.
      schema: {
        type: "array",
        items: { type: "string" },
        description: "A list of URLs from the search results page.",
      },
    });

    await browser.close();

    console.log(`Found ${searchResults.length} potential websites.`);
    return { search_results: searchResults, processed_urls: [] };
  } catch (error) {
    console.error("Error in Search Agent:", error);
    await stagehand.kill(); // Ensure browser is closed on error
    return { search_results: [], error: "Search agent failed." };
  }
}