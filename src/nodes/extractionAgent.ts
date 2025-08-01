import { Stagehand } from "@browserbasehq/stagehand";
import { AgentState } from "../graph";

// Best Practice: Cache actions to avoid redundant LLM calls for the same task.
// A simple in-memory cache for demonstration purposes.
const cache = new Map<string, any>();

export async function extractionAgent(state: AgentState): Promise<Partial<AgentState>> {
  console.log("---");
  console.log("Executing Extraction Agent");
  
  if (!state.current_url) {
    console.log("No URL to extract from. Skipping.");
    return { extracted_data: null };
  }

  const cacheKey = `extract:${state.current_url}`;
  if (cache.has(cacheKey)) {
    console.log("Cache HIT for extraction.");
    return { extracted_data: cache.get(cacheKey) };
  }
  console.log("Cache MISS for extraction.");

  const stagehand = new Stagehand();
  try {
    const { page, browser } = await stagehand.init({ local: true });
    await page.goto(state.current_url, { waitUntil: 'domcontentloaded' });

    // Best Practice: Don't send sensitive info to LLMs.
    // The extracted data (PII) is processed locally and never sent to the LLM.
    // The LLM only generates the code to find the data.
    const instruction = "Extract a list of contacts from the page, including their name, email, and phone number if available. Look for mailto: links and phone numbers.";
    const extractedData = await stagehand.get(instruction, {
      page,
      schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The person's or company's name" },
            email: { type: "string", description: "The contact email address" },
            phone: { type: "string", description: "The contact phone number" },
          },
          required: ["name"],
        },
      },
    });

    await browser.close();
    
    console.log("Successfully extracted data:", extractedData);
    cache.set(cacheKey, extractedData); // Store result in cache

    return { extracted_data: extractedData };
  } catch (error) {
    console.error("Error in Extraction Agent:", error);
    await stagehand.kill();
    return { extracted_data: null, error: "Extraction failed." };
  }
}