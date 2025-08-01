import readline from "readline-sync";
import { AgentState } from "../graph";

export function humanInTheLoopNode(state: AgentState): Partial<AgentState> {
  console.log("---");
  console.log("Waiting for Human-in-the-Loop (HITL) Approval");

  if (!state.extracted_data || state.extracted_data.length === 0) {
    console.log("No data was extracted. Nothing to approve.");
    return { user_approved_data: null };
  }
  
  console.log("Extracted the following potential leads:");
  console.table(state.extracted_data);
  
  const response = readline.question(`Approve and save these ${state.extracted_data.length} lead(s)? (y/n): `);

  if (response.toLowerCase() === 'y') {
    console.log("User approved. Data will be saved.");
    return { user_approved_data: state.extracted_data };
  } else {
    console.log("User rejected. Data will be discarded.");
    return { user_approved_data: null };
  }
}