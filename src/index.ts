#!/usr/bin/env node

import { CLIInterface } from './cli';
import { ConfigManager } from './config/manager';
import { logger } from './utils/logger';
import chalk from 'chalk';

async function main() {
  try {
    // Display banner
    console.log(chalk.blue.bold(`
╔═══════════════════════════════════════════════════════════════╗
║                   🚀 Lead Generation System                   ║
║                                                               ║
║  Powered by Stagehand • LangGraph • OpenAI                   ║
║  Multi-Agent Lead Extraction with Compliance                 ║
╚═══════════════════════════════════════════════════════════════╝
`));

    // Initialize configuration
    const configManager = ConfigManager.getInstance();
    
    if (!configManager.validateConfig()) {
      console.error(chalk.red('❌ Configuration validation failed. Please check your .env file.'));
      process.exit(1);
    }

    logger.info('Application starting', {
      version: '1.0.0',
      nodeVersion: process.version,
      platform: process.platform
    });

    // Start CLI interface
    const cli = new CLIInterface();
    await cli.start();

  } catch (error) {
    console.error(chalk.red('💥 Fatal error:'), error);
    logger.error('Fatal application error', { error });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n🛑 Received SIGINT, shutting down gracefully...'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n🛑 Received SIGTERM, shutting down gracefully...'));
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  console.error(chalk.red('💥 Unhandled promise rejection:'), reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  console.error(chalk.red('💥 Uncaught exception:'), error);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main();
}