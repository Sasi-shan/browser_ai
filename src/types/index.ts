import { z } from 'zod';

// Lead Information Schema
export const LeadSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email required').optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  position: z.string().optional(),
  location: z.string().optional(),
  linkedin: z.string().url().optional(),
  website: z.string().url().optional(),
  source: z.string(),
  extractedAt: z.date(),
  confidence: z.number().min(0).max(1),
  verified: z.boolean().default(false)
});

export type Lead = z.infer<typeof LeadSchema>;

// Task Configuration Schema
export const TaskConfigSchema = z.object({
  id: z.string(),
  type: z.enum(['linkedin_search', 'directory_scan', 'website_extraction']),
  target: z.string().url(),
  searchQuery: z.string().optional(),
  maxResults: z.number().min(1).max(100).default(10),
  filters: z.record(z.any()).optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  retryAttempts: z.number().min(0).max(3).default(2)
});

export type TaskConfig = z.infer<typeof TaskConfigSchema>;

// Agent State Schema
export const AgentStateSchema = z.object({
  currentTask: TaskConfigSchema.optional(),
  pendingTasks: z.array(TaskConfigSchema),
  completedTasks: z.array(z.string()),
  extractedLeads: z.array(LeadSchema),
  errors: z.array(z.string()),
  humanApprovalRequired: z.boolean().default(false),
  currentAction: z.string().optional(),
  context: z.record(z.any()).optional()
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// Stagehand Action Preview
export interface ActionPreview {
  action: string;
  target: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  compliance: {
    termsOfService: boolean;
    robotsTxt: boolean;
    rateLimit: boolean;
  };
}

// Cache Entry
export interface CacheEntry {
  key: string;
  data: any;
  timestamp: number;
  ttl: number;
}

// Evaluation Metrics
export interface EvaluationMetrics {
  taskId: string;
  llmCallsCount: number;
  tokensUsed: number;
  executionTime: number;
  successRate: number;
  leadsExtracted: number;
  complianceScore: number;
}

// Configuration
export interface Config {
  openai: {
    apiKey: string;
    model: string;
    temperature: number;
  };
  stagehand: {
    logLevel: string;
    headless: boolean;
    timeout: number;
  };
  compliance: {
    respectRobotsTxt: boolean;
    userAgent: string;
    rateLimitDelay: number;
  };
  output: {
    directory: string;
    csvFile: string;
  };
  humanInLoop: {
    requireApproval: boolean;
    autoApprove: boolean;
  };
}

// Error Types
export class LeadGenerationError extends Error {
  constructor(
    message: string,
    public code: string,
    public taskId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'LeadGenerationError';
  }
}

export class ComplianceError extends LeadGenerationError {
  constructor(message: string, taskId?: string) {
    super(message, 'COMPLIANCE_ERROR', taskId);
    this.name = 'ComplianceError';
  }
}

export class ExtractionError extends LeadGenerationError {
  constructor(message: string, taskId?: string, cause?: Error) {
    super(message, 'EXTRACTION_ERROR', taskId, cause);
    this.name = 'ExtractionError';
  }
}