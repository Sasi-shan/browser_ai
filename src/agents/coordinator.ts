import { StateGraph, END, START } from '@langchain/langgraph';
import { AgentState, TaskConfig, Lead, AgentStateSchema } from '../types';
import { LinkedInAgent } from './linkedin';
import { DirectoryAgent } from './directory';
import { WebsiteAgent } from './website';
import { StagehandWrapper } from '../stagehand/wrapper';
import { logger, StructuredLogger } from '../utils/logger';
import { CacheManager } from '../utils/cache';

export class LeadGenerationCoordinator {
  private stagehand: StagehandWrapper;
  private linkedinAgent: LinkedInAgent;
  private directoryAgent: DirectoryAgent;
  private websiteAgent: WebsiteAgent;
  private cache: CacheManager;
  private graph: StateGraph<AgentState>;

  constructor() {
    this.stagehand = new StagehandWrapper();
    this.linkedinAgent = new LinkedInAgent(this.stagehand);
    this.directoryAgent = new DirectoryAgent(this.stagehand);
    this.websiteAgent = new WebsiteAgent(this.stagehand);
    this.cache = CacheManager.getInstance();
    
    this.buildGraph();
  }

  private buildGraph(): void {
    // Create the state graph
    this.graph = new StateGraph<AgentState>({
      channels: {
        currentTask: null,
        pendingTasks: [],
        completedTasks: [],
        extractedLeads: [],
        errors: [],
        humanApprovalRequired: false,
        currentAction: null,
        context: {}
      }
    });

    // Add nodes
    this.graph.addNode('task_router', this.routeTask.bind(this));
    this.graph.addNode('linkedin_agent', this.executeLinkedInTask.bind(this));
    this.graph.addNode('directory_agent', this.executeDirectoryTask.bind(this));
    this.graph.addNode('website_agent', this.executeWebsiteTask.bind(this));
    this.graph.addNode('human_approval', this.handleHumanApproval.bind(this));
    this.graph.addNode('validate_leads', this.validateLeads.bind(this));
    this.graph.addNode('merge_results', this.mergeResults.bind(this));

    // Add edges
    this.graph.addEdge(START, 'task_router');
    
    this.graph.addConditionalEdges(
      'task_router',
      this.routingCondition.bind(this),
      {
        'linkedin': 'linkedin_agent',
        'directory': 'directory_agent',
        'website': 'website_agent',
        'human_approval': 'human_approval',
        'complete': 'merge_results'
      }
    );

    this.graph.addEdge('linkedin_agent', 'validate_leads');
    this.graph.addEdge('directory_agent', 'validate_leads');
    this.graph.addEdge('website_agent', 'validate_leads');
    this.graph.addEdge('human_approval', 'task_router');
    this.graph.addEdge('validate_leads', 'task_router');
    this.graph.addEdge('merge_results', END);

    // Compile the graph
    this.graph = this.graph.compile();
  }

  async initialize(): Promise<void> {
    await this.stagehand.initialize();
    logger.info('Lead Generation Coordinator initialized');
  }

  async executeTasks(tasks: TaskConfig[]): Promise<Lead[]> {
    try {
      const initialState: AgentState = {
        pendingTasks: tasks,
        completedTasks: [],
        extractedLeads: [],
        errors: [],
        humanApprovalRequired: false,
        context: {
          startTime: Date.now(),
          totalTasks: tasks.length
        }
      };

      logger.info(`Starting execution of ${tasks.length} tasks`);

      // Execute the graph
      const finalState = await this.graph.invoke(initialState);

      logger.info(`Task execution completed. ${finalState.extractedLeads.length} leads extracted`);
      
      return finalState.extractedLeads;

    } catch (error) {
      logger.error('Task execution failed', { error });
      throw error;
    }
  }

  private async routeTask(state: AgentState): Promise<Partial<AgentState>> {
    try {
      // Get next pending task
      if (state.pendingTasks.length === 0) {
        return { currentAction: 'complete' };
      }

      const nextTask = state.pendingTasks[0];
      const remainingTasks = state.pendingTasks.slice(1);

      logger.info(`Routing task: ${nextTask.id} (${nextTask.type})`);

      return {
        currentTask: nextTask,
        pendingTasks: remainingTasks,
        currentAction: nextTask.type
      };

    } catch (error) {
      logger.error('Task routing failed', { error });
      return {
        errors: [...(state.errors || []), `Task routing failed: ${error}`],
        currentAction: 'complete'
      };
    }
  }

  private routingCondition(state: AgentState): string {
    if (state.humanApprovalRequired) {
      return 'human_approval';
    }

    if (!state.currentTask) {
      return 'complete';
    }

    switch (state.currentTask.type) {
      case 'linkedin_search':
        return 'linkedin';
      case 'directory_scan':
        return 'directory';
      case 'website_extraction':
        return 'website';
      default:
        return 'complete';
    }
  }

  private async executeLinkedInTask(state: AgentState): Promise<Partial<AgentState>> {
    if (!state.currentTask) {
      return { errors: [...(state.errors || []), 'No current task for LinkedIn agent'] };
    }

    try {
      logger.info(`Executing LinkedIn task: ${state.currentTask.id}`);
      
      const leads = await this.linkedinAgent.executeTask(state.currentTask);
      
      return {
        extractedLeads: [...(state.extractedLeads || []), ...leads],
        completedTasks: [...(state.completedTasks || []), state.currentTask.id],
        currentTask: undefined,
        context: {
          ...state.context,
          lastLinkedInExecution: Date.now(),
          linkedInLeadsCount: leads.length
        }
      };

    } catch (error) {
      logger.error(`LinkedIn task failed: ${state.currentTask.id}`, { error });
      
      // Check if retry is needed
      const retryCount = (state.context?.retryCount || 0);
      if (retryCount < (state.currentTask.retryAttempts || 0)) {
        return {
          pendingTasks: [...state.pendingTasks, {
            ...state.currentTask,
            retryAttempts: (state.currentTask.retryAttempts || 0) - 1
          }],
          currentTask: undefined,
          errors: [...(state.errors || []), `LinkedIn task retry ${retryCount + 1}: ${error}`],
          context: {
            ...state.context,
            retryCount: retryCount + 1
          }
        };
      }

      return {
        errors: [...(state.errors || []), `LinkedIn task failed: ${error}`],
        completedTasks: [...(state.completedTasks || []), state.currentTask.id],
        currentTask: undefined
      };
    }
  }

  private async executeDirectoryTask(state: AgentState): Promise<Partial<AgentState>> {
    if (!state.currentTask) {
      return { errors: [...(state.errors || []), 'No current task for Directory agent'] };
    }

    try {
      logger.info(`Executing Directory task: ${state.currentTask.id}`);
      
      const leads = await this.directoryAgent.executeTask(state.currentTask);
      
      return {
        extractedLeads: [...(state.extractedLeads || []), ...leads],
        completedTasks: [...(state.completedTasks || []), state.currentTask.id],
        currentTask: undefined,
        context: {
          ...state.context,
          lastDirectoryExecution: Date.now(),
          directoryLeadsCount: leads.length
        }
      };

    } catch (error) {
      logger.error(`Directory task failed: ${state.currentTask.id}`, { error });
      
      const retryCount = (state.context?.retryCount || 0);
      if (retryCount < (state.currentTask.retryAttempts || 0)) {
        return {
          pendingTasks: [...state.pendingTasks, {
            ...state.currentTask,
            retryAttempts: (state.currentTask.retryAttempts || 0) - 1
          }],
          currentTask: undefined,
          errors: [...(state.errors || []), `Directory task retry ${retryCount + 1}: ${error}`],
          context: {
            ...state.context,
            retryCount: retryCount + 1
          }
        };
      }

      return {
        errors: [...(state.errors || []), `Directory task failed: ${error}`],
        completedTasks: [...(state.completedTasks || []), state.currentTask.id],
        currentTask: undefined
      };
    }
  }

  private async executeWebsiteTask(state: AgentState): Promise<Partial<AgentState>> {
    if (!state.currentTask) {
      return { errors: [...(state.errors || []), 'No current task for Website agent'] };
    }

    try {
      logger.info(`Executing Website task: ${state.currentTask.id}`);
      
      const leads = await this.websiteAgent.executeTask(state.currentTask);
      
      return {
        extractedLeads: [...(state.extractedLeads || []), ...leads],
        completedTasks: [...(state.completedTasks || []), state.currentTask.id],
        currentTask: undefined,
        context: {
          ...state.context,
          lastWebsiteExecution: Date.now(),
          websiteLeadsCount: leads.length
        }
      };

    } catch (error) {
      logger.error(`Website task failed: ${state.currentTask.id}`, { error });
      
      const retryCount = (state.context?.retryCount || 0);
      if (retryCount < (state.currentTask.retryAttempts || 0)) {
        return {
          pendingTasks: [...state.pendingTasks, {
            ...state.currentTask,
            retryAttempts: (state.currentTask.retryAttempts || 0) - 1
          }],
          currentTask: undefined,
          errors: [...(state.errors || []), `Website task retry ${retryCount + 1}: ${error}`],
          context: {
            ...state.context,
            retryCount: retryCount + 1
          }
        };
      }

      return {
        errors: [...(state.errors || []), `Website task failed: ${error}`],
        completedTasks: [...(state.completedTasks || []), state.currentTask.id],
        currentTask: undefined
      };
    }
  }

  private async handleHumanApproval(state: AgentState): Promise<Partial<AgentState>> {
    try {
      logger.info('Handling human approval request');
      
      // In a real implementation, this would integrate with a UI or notification system
      // For now, we'll simulate human approval based on task risk level
      const approved = await this.simulateHumanApproval(state);
      
      StructuredLogger.logHumanInteraction(
        state.currentAction || 'unknown',
        approved
      );

      if (approved) {
        return {
          humanApprovalRequired: false,
          context: {
            ...state.context,
            humanApprovalGranted: true,
            approvalTimestamp: Date.now()
          }
        };
      } else {
        return {
          humanApprovalRequired: false,
          errors: [...(state.errors || []), 'Human approval denied'],
          completedTasks: [...(state.completedTasks || []), state.currentTask?.id || 'unknown'],
          currentTask: undefined
        };
      }

    } catch (error) {
      logger.error('Human approval handling failed', { error });
      return {
        humanApprovalRequired: false,
        errors: [...(state.errors || []), `Human approval failed: ${error}`]
      };
    }
  }

  private async simulateHumanApproval(state: AgentState): Promise<boolean> {
    // Simulate human approval logic
    // In production, this would be replaced with actual human interaction
    
    if (!state.currentTask) return false;
    
    // Low priority or retry tasks are auto-approved
    if (state.currentTask.priority === 'low' || (state.context?.retryCount || 0) > 0) {
      return true;
    }
    
    // High-risk tasks might require actual human approval
    if (state.currentTask.priority === 'high') {
      // In production, show UI prompt or send notification
      logger.info('High priority task requires human approval', { 
        taskId: state.currentTask.id,
        type: state.currentTask.type 
      });
      
      // For demo, approve after delay
      await this.delay(2000);
      return true;
    }
    
    return true; // Default approve
  }

  private async validateLeads(state: AgentState): Promise<Partial<AgentState>> {
    try {
      logger.info('Validating extracted leads');
      
      const validatedLeads: Lead[] = [];
      const errors: string[] = [...(state.errors || [])];

      for (const lead of state.extractedLeads || []) {
        try {
          // Validate lead schema
          const validatedLead = LeadSchema.parse(lead);
          
          // Additional validation logic
          const isValid = await this.validateLeadData(validatedLead);
          
          if (isValid) {
            validatedLeads.push({ ...validatedLead, verified: true });
          } else {
            logger.warn('Lead failed validation', { leadName: lead.name });
          }
          
        } catch (validationError) {
          errors.push(`Lead validation failed: ${validationError}`);
          logger.warn('Lead schema validation failed', { lead, error: validationError });
        }
      }

      logger.info(`Lead validation completed: ${validatedLeads.length}/${(state.extractedLeads || []).length} leads validated`);

      return {
        extractedLeads: validatedLeads,
        errors,
        context: {
          ...state.context,
          validationCompleted: true,
          validatedLeadsCount: validatedLeads.length,
          validationTimestamp: Date.now()
        }
      };

    } catch (error) {
      logger.error('Lead validation failed', { error });
      return {
        errors: [...(state.errors || []), `Lead validation failed: ${error}`]
      };
    }
  }

  private async validateLeadData(lead: Lead): Promise<boolean> {
    try {
      // Check cache for previous validation
      const cacheKey = `validation:${lead.email || lead.phone || lead.name}`;
      const cachedResult = this.cache.get<boolean>(cacheKey);
      if (cachedResult !== undefined) {
        return cachedResult;
      }

      let isValid = true;

      // Email validation
      if (lead.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(lead.email)) {
          isValid = false;
        }
      }

      // Phone validation
      if (lead.phone) {
        const phoneDigits = lead.phone.replace(/\D/g, '');
        if (phoneDigits.length < 10 || phoneDigits.length > 15) {
          isValid = false;
        }
      }

      // Name validation
      if (!lead.name || lead.name.length < 2) {
        isValid = false;
      }

      // Cache the result
      this.cache.set(cacheKey, isValid, 86400); // Cache for 24 hours

      return isValid;

    } catch (error) {
      logger.warn('Lead validation error', { lead, error });
      return false;
    }
  }

  private async mergeResults(state: AgentState): Promise<Partial<AgentState>> {
    try {
      logger.info('Merging final results');

      // Remove duplicates based on email or phone
      const uniqueLeads = this.removeDuplicateLeads(state.extractedLeads || []);
      
      // Sort by confidence score
      uniqueLeads.sort((a, b) => b.confidence - a.confidence);

      const executionTime = Date.now() - (state.context?.startTime || Date.now());
      
      logger.info('Lead generation completed', {
        totalLeads: uniqueLeads.length,
        executionTime,
        completedTasks: state.completedTasks?.length || 0,
        errors: state.errors?.length || 0
      });

      return {
        extractedLeads: uniqueLeads,
        context: {
          ...state.context,
          executionCompleted: true,
          finalLeadCount: uniqueLeads.length,
          executionTime
        }
      };

    } catch (error) {
      logger.error('Result merging failed', { error });
      return {
        errors: [...(state.errors || []), `Result merging failed: ${error}`]
      };
    }
  }

  private removeDuplicateLeads(leads: Lead[]): Lead[] {
    const seen = new Set<string>();
    const uniqueLeads: Lead[] = [];

    for (const lead of leads) {
      const identifier = lead.email || lead.phone || `${lead.name}-${lead.company}`;
      
      if (!seen.has(identifier)) {
        seen.add(identifier);
        uniqueLeads.push(lead);
      } else {
        // If duplicate found, keep the one with higher confidence
        const existingIndex = uniqueLeads.findIndex(existing => {
          const existingId = existing.email || existing.phone || `${existing.name}-${existing.company}`;
          return existingId === identifier;
        });

        if (existingIndex >= 0 && lead.confidence > uniqueLeads[existingIndex].confidence) {
          uniqueLeads[existingIndex] = lead;
        }
      }
    }

    return uniqueLeads;
  }

  // Utility methods for creating common task configurations
  createLinkedInSearchTask(searchQuery: string, maxResults: number = 10, filters?: any): TaskConfig {
    return {
      id: `linkedin-search-${Date.now()}`,
      type: 'linkedin_search',
      target: 'https://www.linkedin.com',
      searchQuery,
      maxResults,
      filters,
      priority: 'medium'
    };
  }

  createDirectorySearchTask(directoryUrl: string, searchQuery: string, location: string, maxResults: number = 20): TaskConfig {
    return {
      id: `directory-search-${Date.now()}`,
      type: 'directory_scan',
      target: directoryUrl,
      searchQuery,
      maxResults,
      filters: { location },
      priority: 'medium'
    };
  }

  createWebsiteExtractionTask(websiteUrl: string, maxResults: number = 10): TaskConfig {
    return {
      id: `website-extraction-${Date.now()}`,
      type: 'website_extraction',
      target: websiteUrl,
      maxResults,
      priority: 'low'
    };
  }

  async getMetrics(): Promise<any> {
    return {
      stagehandMetrics: this.stagehand.getAllMetrics(),
      cacheStats: this.cache.getStats()
    };
  }

  async cleanup(): Promise<void> {
    try {
      await this.stagehand.cleanup();
      this.cache.clear();
      logger.info('Lead Generation Coordinator cleanup completed');
    } catch (error) {
      logger.error('Cleanup failed', { error });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}