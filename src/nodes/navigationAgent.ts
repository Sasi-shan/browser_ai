import { Stagehand } from "@browserbasehq/stagehand";
import { AgentState } from "../graph";

export async function navigationAgent(state: AgentState): Promise<Partial<AgentState>> {
  console.log("---");
  console.log("Executing Navigation Agent");
  
  // Find the next URL to process
  const nextUrl = state.search_results.find(url => !state.processed_urls.includes(url));

  if (!nextUrl) {
    console.log("No new URLs to process.");
    return { current_url: null }; // Signal that we're done
  }
  
  console.log(`Navigating to: ${nextUrl}`);
  const stagehand = new Stagehand();
  try {
    const { page, browser } = await stagehand.init({ local: true });
    await page.goto(nextUrl, { waitUntil: 'domcontentloaded' });
    
    // Best Practice: Preview actions before running. Use DEBUG=true env var for this.
    // Here, the instruction is specific to finding a common contact link.
    await stagehand.assist("Click on the link that leads to the 'Contact', 'About', or 'Team' page.", {
      page,
    });
    
    const contactPageUrl = page.url();
    console.log(`Found contact/about page: ${contactPageUrl}`);
    
    await browser.close();

    return { 
      current_url: contactPageUrl,
      // Add the original URL to the processed list
      processed_urls: [...state.processed_urls, nextUrl]
    };
  } catch (error) {
    console.error(`Error navigating to or finding contact page on ${nextUrl}:`, error);
    await stagehand.kill();
    // Mark as processed even if it failed, to avoid retrying endlessly
    return { 
      current_url: null, 
      processed_urls: [...state.processed_urls, nextUrl],
      error: `Navigation failed for ${nextUrl}`
    };
  }
}