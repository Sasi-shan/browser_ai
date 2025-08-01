import { StateGraph, END } from "@langchain/langgraph";
import { searchAgent } from "./nodes/searchAgent";
import { navigationAgent } from "./nodes/navigationAgent";
import { extractionAgent } from "./nodes/extractionAgent";
import { humanInTheLoopNode } from "./nodes/humanInTheLoopNode";
import { storageNode } from "./nodes/storageNode";

// Define the state that will be passed between nodes
export interface AgentState {
  query: string;
  search_results: string[];
  processed_urls: string[];
  current_url: string | null;
  extracted_data: any[] | null;
  user_approved_data: any[] | null;
  final_output: any[];
  error?: string;
}

const workflow = new StateGraph<AgentState>({
  channels: {
    query: { value: (x, y) => y, default: () => "" },
    search_results: { value: (x, y) => y, default: () => [] },
    processed_urls: { value: (x, y) => y, default: () => [] },
    current_url: { value: (x, y) => y, default: () => null },
    extracted_data: { value: (x, y) => y, default: () => null },
    user_approved_data: { value: (x, y) => y, default: () => null },
    final_output: { value: (x, y) => x.concat(y), default: () => [] },
    error: { value: (x, y) => y, default: () => undefined },
  },
});

// Add nodes to the graph
workflow.addNode("search", searchAgent);
workflow.addNode("navigate", navigationAgent);
workflow.addNode("extract", extractionAgent);
workflow.addNode("human_in_loop", humanInTheLoopNode);
workflow.addNode("save", storageNode);

// Define the edges and control flow
workflow.setEntryPoint("search");
workflow.addEdge("search", "navigate");

// After saving, decide if there are more URLs to process
workflow.addEdge("save", "navigate");

// After navigation, decide whether to extract or end
workflow.addConditionalEdges("navigate", (state) => {
  if (state.error || !state.current_url) {
    // If navigation failed or there are no more URLs, check if we're done
    const remaining = state.search_results.filter(url => !state.processed_urls.includes(url));
    return remaining.length > 0 ? "navigate" : END;
  }
  return "extract";
});

workflow.addEdge("extract", "human_in_loop");
workflow.addEdge("human_in_loop", "save");


// Compile the graph into a runnable object
export const app = workflow.compile();