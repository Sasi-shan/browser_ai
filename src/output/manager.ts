import { Lead, EvaluationMetrics } from '../types';
import { logger } from '../utils/logger';
import { ConfigManager } from '../config/manager';
import * as fs from 'fs';
import * as path from 'path';
import csvWriter from 'csv-writer';

export class OutputManager {
  private config: any;
  private outputDir: string;

  constructor() {
    this.config = ConfigManager.getInstance().config;
    this.outputDir = this.config.output.directory;
    this.ensureOutputDirectory();
  }

  private ensureOutputDirectory(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
      logger.info(`Created output directory: ${this.outputDir}`);
    }
  }

  async exportToCSV(leads: Lead[], filename?: string): Promise<string> {
    try {
      const csvFileName = filename || this.config.output.csvFile;
      const filePath = path.join(this.outputDir, csvFileName);

      const csvWriterInstance = csvWriter.createObjectCsvWriter({
        path: filePath,
        header: [
          { id: 'name', title: 'Name' },
          { id: 'email', title: 'Email' },
          { id: 'phone', title: 'Phone' },
          { id: 'company', title: 'Company' },
          { id: 'position', title: 'Position' },
          { id: 'location', title: 'Location' },
          { id: 'linkedin', title: 'LinkedIn' },
          { id: 'website', title: 'Website' },
          { id: 'source', title: 'Source' },
          { id: 'extractedAt', title: 'Extracted At' },
          { id: 'confidence', title: 'Confidence Score' },
          { id: 'verified', title: 'Verified' }
        ]
      });

      // Prepare data for CSV
      const csvData = leads.map(lead => ({
        ...lead,
        extractedAt: lead.extractedAt.toISOString(),
        confidence: lead.confidence.toFixed(2)
      }));

      await csvWriterInstance.writeRecords(csvData);
      
      logger.info(`Leads exported to CSV: ${filePath}`, { 
        leadCount: leads.length,
        filePath 
      });

      return filePath;

    } catch (error) {
      logger.error('CSV export failed', { error });
      throw error;
    }
  }

  async exportToJSON(leads: Lead[], filename?: string): Promise<string> {
    try {
      const jsonFileName = filename || 'leads.json';
      const filePath = path.join(this.outputDir, jsonFileName);

      const jsonData = {
        exportedAt: new Date().toISOString(),
        totalLeads: leads.length,
        leads: leads.map(lead => ({
          ...lead,
          extractedAt: lead.extractedAt.toISOString()
        }))
      };

      fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
      
      logger.info(`Leads exported to JSON: ${filePath}`, { 
        leadCount: leads.length,
        filePath 
      });

      return filePath;

    } catch (error) {
      logger.error('JSON export failed', { error });
      throw error;
    }
  }

  async exportMetricsReport(
    metrics: EvaluationMetrics[],
    summary: any,
    filename?: string
  ): Promise<string> {
    try {
      const reportFileName = filename || 'metrics_report.json';
      const filePath = path.join(this.outputDir, reportFileName);

      const report = {
        generatedAt: new Date().toISOString(),
        summary: {
          totalTasks: metrics.length,
          totalLeadsExtracted: metrics.reduce((sum, m) => sum + m.leadsExtracted, 0),
          totalLLMCalls: metrics.reduce((sum, m) => sum + m.llmCallsCount, 0),
          totalTokensUsed: metrics.reduce((sum, m) => sum + m.tokensUsed, 0),
          averageSuccessRate: metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length,
          totalExecutionTime: metrics.reduce((sum, m) => sum + m.executionTime, 0),
          averageComplianceScore: metrics.reduce((sum, m) => sum + m.complianceScore, 0) / metrics.length,
          ...summary
        },
        taskMetrics: metrics,
        recommendations: this.generateRecommendations(metrics)
      };

      fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
      
      logger.info(`Metrics report exported: ${filePath}`);
      return filePath;

    } catch (error) {
      logger.error('Metrics report export failed', { error });
      throw error;
    }
  }

  private generateRecommendations(metrics: EvaluationMetrics[]): string[] {
    const recommendations: string[] = [];

    // Performance recommendations
    const avgExecutionTime = metrics.reduce((sum, m) => sum + m.executionTime, 0) / metrics.length;
    if (avgExecutionTime > 30000) { // 30 seconds
      recommendations.push('Consider optimizing task execution time - average exceeds 30 seconds');
    }

    // Success rate recommendations
    const avgSuccessRate = metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length;
    if (avgSuccessRate < 0.8) {
      recommendations.push('Success rate is below 80% - review error handling and retry logic');
    }

    // LLM usage recommendations
    const totalTokens = metrics.reduce((sum, m) => sum + m.tokensUsed, 0);
    if (totalTokens > 100000) {
      recommendations.push('High token usage detected - consider implementing more aggressive caching');
    }

    // Compliance recommendations
    const avgComplianceScore = metrics.reduce((sum, m) => sum + m.complianceScore, 0) / metrics.length;
    if (avgComplianceScore < 0.9) {
      recommendations.push('Compliance score is below 90% - review rate limiting and ToS adherence');
    }

    return recommendations;
  }

  async generateComplianceReport(leads: Lead[]): Promise<string> {
    try {
      const reportFilePath = path.join(this.outputDir, 'compliance_report.json');

      // Analyze lead sources for compliance
      const sourceAnalysis = this.analyzeLeadSources(leads);
      const privacyAnalysis = this.analyzePrivacyCompliance(leads);

      const complianceReport = {
        generatedAt: new Date().toISOString(),
        totalLeads: leads.length,
        sourceAnalysis,
        privacyAnalysis,
        gdprCompliance: this.assessGDPRCompliance(leads),
        ccpaCompliance: this.assessCCPACompliance(leads),
        recommendations: this.generateComplianceRecommendations(leads)
      };

      fs.writeFileSync(reportFilePath, JSON.stringify(complianceReport, null, 2));
      
      logger.info(`Compliance report generated: ${reportFilePath}`);
      return reportFilePath;

    } catch (error) {
      logger.error('Compliance report generation failed', { error });
      throw error;
    }
  }

  private analyzeLeadSources(leads: Lead[]): any {
    const sourceCounts = leads.reduce((acc, lead) => {
      acc[lead.source] = (acc[lead.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalSources: Object.keys(sourceCounts).length,
      sourceBreakdown: sourceCounts,
      mostCommonSource: Object.entries(sourceCounts).reduce((a, b) => a[1] > b[1] ? a : b)[0]
    };
  }

  private analyzePrivacyCompliance(leads: Lead[]): any {
    const hasEmail = leads.filter(lead => lead.email).length;
    const hasPhone = leads.filter(lead => lead.phone).length;
    const hasLinkedIn = leads.filter(lead => lead.linkedin).length;

    return {
      leadsWithEmail: hasEmail,
      leadsWithPhone: hasPhone,
      leadsWithLinkedIn: hasLinkedIn,
      personalDataPercentage: ((hasEmail + hasPhone) / leads.length * 100).toFixed(2) + '%'
    };
  }

  private assessGDPRCompliance(leads: Lead[]): any {
    // Basic GDPR compliance assessment
    return {
      hasLawfulBasis: true, // Assuming legitimate interest for B2B leads
      dataMinimization: this.assessDataMinimization(leads),
      consentRequired: leads.filter(lead => 
        lead.location?.toLowerCase().includes('eu') || 
        lead.location?.toLowerCase().includes('europe')
      ).length,
      retentionPeriod: '2 years (configurable)',
      rightToErasure: 'Supported via data deletion endpoints'
    };
  }

  private assessCCPACompliance(leads: Lead[]): any {
    return {
      californiResidents: leads.filter(lead => 
        lead.location?.toLowerCase().includes('california') ||
        lead.location?.toLowerCase().includes('ca')
      ).length,
      dataCategories: ['Contact Information', 'Professional Information'],
      businessPurpose: 'Lead generation and business development',
      thirdPartySharing: false,
      optOutMechanism: 'Available via privacy settings'
    };
  }

  private assessDataMinimization(leads: Lead[]): any {
    const totalFields = leads.length * 12; // 12 possible fields per lead
    const populatedFields = leads.reduce((sum, lead) => {
      return sum + Object.values(lead).filter(value => 
        value !== undefined && value !== null && value !== ''
      ).length;
    }, 0);

    return {
      dataMinimizationScore: ((populatedFields / totalFields) * 100).toFixed(2) + '%',
      recommendation: populatedFields / totalFields > 0.7 ? 
        'Consider collecting only essential data fields' : 
        'Good data minimization practices'
    };
  }

  private generateComplianceRecommendations(leads: Lead[]): string[] {
    const recommendations: string[] = [];

    const hasPersonalData = leads.some(lead => lead.email || lead.phone);
    if (hasPersonalData) {
      recommendations.push('Implement data retention policies for personal information');
      recommendations.push('Provide clear opt-out mechanisms for all collected contacts');
    }

    const hasEULeads = leads.some(lead => 
      lead.location?.toLowerCase().includes('eu') || 
      lead.location?.toLowerCase().includes('europe')
    );
    if (hasEULeads) {
      recommendations.push('Ensure GDPR consent mechanisms are in place for EU residents');
    }

    const hasCALeads = leads.some(lead => 
      lead.location?.toLowerCase().includes('california')
    );
    if (hasCALeads) {
      recommendations.push('Implement CCPA compliance measures for California residents');
    }

    return recommendations;
  }

  async exportSummaryReport(
    leads: Lead[],
    metrics: EvaluationMetrics[],
    executionTime: number
  ): Promise<string> {
    try {
      const reportFilePath = path.join(this.outputDir, 'summary_report.html');

      const html = this.generateHTMLReport(leads, metrics, executionTime);
      fs.writeFileSync(reportFilePath, html);

      logger.info(`Summary report generated: ${reportFilePath}`);
      return reportFilePath;

    } catch (error) {
      logger.error('Summary report generation failed', { error });
      throw error;
    }
  }

  private generateHTMLReport(
    leads: Lead[],
    metrics: EvaluationMetrics[],
    executionTime: number
  ): string {
    const sourceStats = leads.reduce((acc, lead) => {
      acc[lead.source] = (acc[lead.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Lead Generation Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { background: #f4f4f4; padding: 20px; border-radius: 5px; }
        .stats { display: flex; justify-content: space-around; margin: 20px 0; }
        .stat-box { text-align: center; padding: 15px; background: #e7f3ff; border-radius: 5px; }
        .stat-number { font-size: 24px; font-weight: bold; color: #2196F3; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .confidence-high { color: #4CAF50; font-weight: bold; }
        .confidence-medium { color: #FF9800; }
        .confidence-low { color: #f44336; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Lead Generation Report</h1>
        <p>Generated on: ${new Date().toLocaleString()}</p>
        <p>Execution Time: ${Math.round(executionTime / 1000)} seconds</p>
    </div>

    <div class="stats">
        <div class="stat-box">
            <div class="stat-number">${leads.length}</div>
            <div>Total Leads</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${leads.filter(l => l.email).length}</div>
            <div>With Email</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${leads.filter(l => l.phone).length}</div>
            <div>With Phone</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${Object.keys(sourceStats).length}</div>
            <div>Sources</div>
        </div>
    </div>

    <h2>Source Breakdown</h2>
    <table>
        <tr><th>Source</th><th>Count</th><th>Percentage</th></tr>
        ${Object.entries(sourceStats).map(([source, count]) => `
            <tr>
                <td>${source}</td>
                <td>${count}</td>
                <td>${((count / leads.length) * 100).toFixed(1)}%</td>
            </tr>
        `).join('')}
    </table>

    <h2>Top Leads (by Confidence Score)</h2>
    <table>
        <tr>
            <th>Name</th>
            <th>Company</th>
            <th>Position</th>
            <th>Email</th>
            <th>Source</th>
            <th>Confidence</th>
        </tr>
        ${leads.slice(0, 20).map(lead => `
            <tr>
                <td>${lead.name}</td>
                <td>${lead.company || 'N/A'}</td>
                <td>${lead.position || 'N/A'}</td>
                <td>${lead.email || 'N/A'}</td>
                <td>${lead.source}</td>
                <td class="${lead.confidence >= 0.8 ? 'confidence-high' : lead.confidence >= 0.6 ? 'confidence-medium' : 'confidence-low'}">
                    ${(lead.confidence * 100).toFixed(1)}%
                </td>
            </tr>
        `).join('')}
    </table>

    <h2>Performance Metrics</h2>
    <table>
        <tr>
            <th>Task ID</th>
            <th>Leads Extracted</th>
            <th>LLM Calls</th>
            <th>Execution Time (s)</th>
            <th>Success Rate</th>
        </tr>
        ${metrics.map(metric => `
            <tr>
                <td>${metric.taskId}</td>
                <td>${metric.leadsExtracted}</td>
                <td>${metric.llmCallsCount}</td>
                <td>${Math.round(metric.executionTime / 1000)}</td>
                <td>${(metric.successRate * 100).toFixed(1)}%</td>
            </tr>
        `).join('')}
    </table>
</body>
</html>`;
  }

  // Utility methods for data formatting
  formatLeadForExport(lead: Lead): any {
    return {
      ...lead,
      extractedAt: lead.extractedAt.toISOString(),
      confidence: Math.round(lead.confidence * 100) / 100,
      verified: lead.verified ? 'Yes' : 'No'
    };
  }

  async exportToMultipleFormats(
    leads: Lead[],
    metrics: EvaluationMetrics[],
    executionTime: number
  ): Promise<{ csv: string; json: string; html: string; compliance: string }> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      const results = {
        csv: await this.exportToCSV(leads, `leads_${timestamp}.csv`),
        json: await this.exportToJSON(leads, `leads_${timestamp}.json`),
        html: await this.exportSummaryReport(leads, metrics, executionTime),
        compliance: await this.generateComplianceReport(leads)
      };

      logger.info('Multi-format export completed', {
        formats: Object.keys(results),
        leadCount: leads.length
      });

      return results;

    } catch (error) {
      logger.error('Multi-format export failed', { error });
      throw error;
    }
  }

  getOutputDirectory(): string {
    return this.outputDir;
  }

  async cleanupOldFiles(daysOld: number = 30): Promise<void> {
    try {
      const files = fs.readdirSync(this.outputDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.outputDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }

      logger.info(`Cleaned up ${deletedCount} old files from output directory`);

    } catch (error) {
      logger.error('File cleanup failed', { error });
    }
  }
}