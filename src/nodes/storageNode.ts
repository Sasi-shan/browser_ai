import fs from "fs";
import { AgentState } from "../graph";

const CSV_FILE = "leads.csv";

export function storageNode(state: AgentState): Partial<AgentState> {
  console.log("---");
  console.log("Executing Storage Node");

  if (!state.user_approved_data || state.user_approved_data.length === 0) {
    console.log("No approved data to save.");
    return {};
  }

  // Ensure CSV header exists
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, "name,email,phone\n");
  }

  const csvContent = state.user_approved_data
    .map(lead => {
      // Basic CSV escaping
      const name = `"${(lead.name || '').replace(/"/g, '""')}"`;
      const email = `"${(lead.email || '').replace(/"/g, '""')}"`;
      const phone = `"${(lead.phone || '').replace(/"/g, '""')}"`;
      return `${name},${email},${phone}`;
    })
    .join("\n");

  fs.appendFileSync(CSV_FILE, csvContent + "\n");
  console.log(`Successfully saved ${state.user_approved_data.length} lead(s) to ${CSV_FILE}`);
  
  // Add saved data to final output
  const finalOutput = [...(state.final_output || []), ...state.user_approved_data];
  
  return { final_output: finalOutput };
}