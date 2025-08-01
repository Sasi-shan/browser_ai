import winston from 'winston';
import { ConfigManager } from '../config/manager';

const config = ConfigManager.getInstance().config;

export const logger = winston.createLogger({
  level: config.stagehand.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
      
      if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta)}`;
      }
      
      if (stack) {
        log += `\n${stack}`;
      }
      
      return log;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ]
});

// Create logs directory if it doesn't exist
import { existsSync, mkdirSync } from 'fs';
if (!existsSync('logs')) {
  mkdirSync('logs');
}

export class StructuredLogger {
  static logTaskStart(taskId: string, taskType: string): void {
    logger.info('Task started', { taskId, taskType, event: 'task_start' });
  }

  static logTaskComplete(taskId: string, leadsFound: number, duration: number): void {
    logger.info('Task completed', { 
      taskId, 
      leadsFound, 
      duration, 
      event: 'task_complete' 
    });
  }

  static logLLMCall(model: string, tokens: number, cost?: number): void {
    logger.info('LLM call made', { 
      model, 
      tokens, 
      cost, 
      event: 'llm_call' 
    });
  }

  static logComplianceCheck(url: string, passed: boolean, reason?: string): void {
    logger.info('Compliance check', { 
      url, 
      passed, 
      reason, 
      event: 'compliance_check' 
    });
  }

  static logHumanInteraction(action: string, approved: boolean): void {
    logger.info('Human interaction', { 
      action, 
      approved, 
      event: 'human_interaction' 
    });
  }

  static logError(error: Error, context?: any): void {
    logger.error('Error occurred', { 
      error: error.message, 
      stack: error.stack,
      context,
      event: 'error' 
    });
  }
}