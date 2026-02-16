import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import { jsPDF } from 'jspdf';
import { AuditAnswerRecord, AuditAnswerService } from '../../services/audit-answer.service';
import { AuditPlanRecord, AuditPlanService } from '../../services/audit-plan.service';
import { NcRecord, NcService } from '../../services/nc.service';
import { TemplateService } from '../../services/template.service';

@Component({
  selector: 'app-reports',
  imports: [CommonModule],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports implements OnInit {
  private readonly auditPlanService = inject(AuditPlanService);
  private readonly auditAnswerService = inject(AuditAnswerService);
  private readonly ncService = inject(NcService);
  private readonly templateService = inject(TemplateService);

  protected reportAudits: AuditPlanRecord[] = [];
  protected loading = true;
  protected error = '';
  protected generating: Record<string, boolean> = {};
  private ncRecords: NcRecord[] = [];

  ngOnInit(): void {
    this.loading = true;
    this.error = '';
    forkJoin([
      this.auditPlanService.migrateFromLocal(),
      this.templateService.migrateFromLocal(),
      this.ncService.listRecords(),
    ]).subscribe({
      next: ([, , ncRecords]) => {
        this.ncRecords = ncRecords;
        this.loadReportableAudits();
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load reports.';
      },
    });
  }

  protected formatDate(value: string): string {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleDateString('en-GB');
  }

  protected async downloadReport(audit: AuditPlanRecord): Promise<void> {
    if (this.generating[audit.code]) {
      return;
    }
    this.generating[audit.code] = true;
    try {
      const answers = await firstValueFrom(this.auditAnswerService.listByAuditCode(audit.code));
      const ncRecords = this.ncRecords.filter((record) => record.auditCode === audit.code);
      if (!this.isAuditClosed(audit, answers, ncRecords)) {
        window.alert('This audit is not closed yet.');
        return;
      }
      this.buildPdf(audit, answers, ncRecords);
    } finally {
      this.generating[audit.code] = false;
    }
  }

  private loadReportableAudits(): void {
    const audits = this.auditPlanService.plans();
    if (!audits.length) {
      this.reportAudits = [];
      this.loading = false;
      return;
    }
    forkJoin(audits.map((audit) => this.auditAnswerService.listByAuditCode(audit.code))).subscribe({
      next: (answersList) => {
        this.reportAudits = audits.filter((audit, index) => {
          const answers = answersList[index] ?? [];
          const ncRecords = this.ncRecords.filter((record) => record.auditCode === audit.code);
          return this.isAuditClosed(audit, answers, ncRecords);
        });
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load reports.';
      },
    });
  }

  private isAuditClosed(
    audit: AuditPlanRecord,
    answers: AuditAnswerRecord[],
    ncRecords: NcRecord[]
  ): boolean {
    if (!answers.length) {
      return false;
    }
    const submittedCount = answers.filter((answer) => answer.status === 'Submitted').length;
    const openStatuses = new Set([
      'Assigned',
      'In Progress',
      'Rework',
      'Resolution Submitted',
      'Pending Review',
    ]);
    const hasOpenNc = ncRecords.some((record) => openStatuses.has(record.status ?? ''));
    return submittedCount >= answers.length && !hasOpenNc;
  }

  private getTemplateQuestionCount(auditType: string, answers: AuditAnswerRecord[]): number {
    const template = this.templateService.templates().find((item) => item.name === auditType);
    if (template?.questions.length) {
      return template.questions.length;
    }
    const maxIndex = answers.reduce((max, answer) => Math.max(max, answer.questionIndex), -1);
    return maxIndex >= 0 ? maxIndex + 1 : answers.length;
  }

  private buildPdf(
    audit: AuditPlanRecord,
    answers: AuditAnswerRecord[],
    ncRecords: NcRecord[]
  ): void {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 36;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let pageNumber = 1;

    const brand = 'AuditX | TierX DCS';
    const addHeaderFooter = (): void => {
      doc.setFontSize(9);
      doc.setTextColor(80, 90, 110);
      doc.text(brand, margin, 26);
      doc.text('Confidential', pageWidth - margin - 70, 26);
      doc.setDrawColor(230);
      doc.line(margin, 32, pageWidth - margin, 32);
      doc.line(margin, pageHeight - 36, pageWidth - margin, pageHeight - 36);
      doc.text(
        `Page ${pageNumber}`,
        pageWidth - margin - 40,
        pageHeight - 18
      );
      doc.setTextColor(0, 0, 0);
    };

    const newPage = (): void => {
      doc.addPage();
      pageNumber += 1;
      addHeaderFooter();
    };

    const ensureSpace = (needed: number): void => {
      if (y + needed <= pageHeight - 50) {
        return;
      }
      newPage();
      y = 50;
    };

    const drawSectionTitle = (title: string): void => {
      ensureSpace(32);
      doc.setFontSize(12);
      doc.setTextColor(32, 41, 57);
      doc.text(title, margin, y);
      y += 16;
      doc.setDrawColor(235);
      doc.line(margin, y, pageWidth - margin, y);
      y += 14;
      doc.setTextColor(0, 0, 0);
    };

    const drawCard = (x: number, top: number, w: number, h: number, title: string, lines: string[]) => {
      doc.setDrawColor(230);
      doc.setFillColor(248, 250, 255);
      doc.roundedRect(x, top, w, h, 8, 8, 'FD');
      doc.setFontSize(10);
      doc.setTextColor(90, 100, 120);
      doc.text(title, x + 10, top + 16);
      doc.setFontSize(11);
      doc.setTextColor(20, 25, 35);
      let lineY = top + 34;
      lines.forEach((line) => {
        const parts = doc.splitTextToSize(line, w - 20);
        doc.text(parts, x + 10, lineY);
        lineY += parts.length * 13;
      });
      doc.setTextColor(0, 0, 0);
    };

    addHeaderFooter();
    let y = 54;

    doc.setFontSize(18);
    doc.text('Audit Report', margin, y);
    y += 22;
    doc.setFontSize(11);
    doc.setTextColor(90, 100, 120);
    doc.text(`Audit code: ${audit.code}`, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 18;

    drawSectionTitle('Audit Metadata');
    const colWidth = (pageWidth - margin * 2 - 16) / 2;
    const cardHeight = 110;
    ensureSpace(cardHeight + 16);
    drawCard(margin, y, colWidth, cardHeight, 'Core details', [
      `Type: ${audit.auditType || '—'}`,
      `Subtype: ${audit.auditSubtype || '—'}`,
      `Auditor: ${audit.auditorName || '—'}`,
      `Response type: ${audit.responseType || '—'}`,
    ]);
    drawCard(margin + colWidth + 16, y, colWidth, cardHeight, 'Location', [
      `Department: ${audit.department || '—'}`,
      `Site: ${audit.site || '—'}`,
      `City: ${audit.locationCity || '—'}`,
      `Region/Country: ${audit.region || '—'} / ${audit.country || '—'}`,
    ]);
    y += cardHeight + 20;

    drawSectionTitle('Scope');
    const scopeText = audit.auditNote || audit.auditSubtype || '—';
    const scopeLines = doc.splitTextToSize(scopeText, pageWidth - margin * 2);
    ensureSpace(scopeLines.length * 14 + 16);
    doc.setFontSize(10.5);
    doc.text(scopeLines, margin, y);
    y += scopeLines.length * 14 + 6;

    drawSectionTitle('Methodology');
    const methodology =
      audit.responseType || 'On-site inspection with evidence capture and NC tracking.';
    const methodLines = doc.splitTextToSize(methodology, pageWidth - margin * 2);
    ensureSpace(methodLines.length * 14 + 16);
    doc.setFontSize(10.5);
    doc.text(methodLines, margin, y);
    y += methodLines.length * 14 + 6;

    drawSectionTitle('Findings Summary');
    const total = answers.length || 1;
    const negative = answers.filter((answer) => answer.responseIsNegative).length;
    const positive = total - negative;
    const statusCounts = ncRecords.reduce<Record<string, number>>((acc, record) => {
      const key = record.status || 'Assigned';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const summaryLines = [
      `Total questions: ${answers.length}`,
      `Positive responses: ${positive}`,
      `Negative responses: ${negative}`,
      `NCs recorded: ${ncRecords.length}`,
    ];
    ensureSpace(90);
    drawCard(margin, y, colWidth, 90, 'Response distribution', summaryLines);
    const statusLines = Object.entries(statusCounts).map(([status, count]) => `${status}: ${count}`);
    drawCard(margin + colWidth + 16, y, colWidth, 90, 'NC status', statusLines.length ? statusLines : ['—']);
    y += 110;

    drawSectionTitle('NC Register');
    if (!ncRecords.length) {
      ensureSpace(20);
      doc.text('No NC records for this audit.', margin, y);
      y += 14;
    } else {
      const sortedNc = [...ncRecords].sort((a, b) =>
        (a.submittedAt || '').localeCompare(b.submittedAt || '')
      );
      sortedNc.forEach((record, idx) => {
        const blockHeight = 86;
        ensureSpace(blockHeight);
        doc.setDrawColor(235);
        doc.roundedRect(margin, y, pageWidth - margin * 2, blockHeight, 6, 6);
        doc.setFontSize(10);
        doc.setTextColor(90, 100, 120);
        doc.text(`NC ${idx + 1}`, margin + 10, y + 18);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10.5);
        const ncLines = [
          `Asset: ${record.assetNumber ?? '—'}`,
          `Question: ${record.question || '—'}`,
          `Assigned NC: ${record.assignedNc || '—'}`,
          `Status: ${record.status || '—'}`,
          `Owner: ${record.assignedUserName || '—'}`,
        ];
        let lineY = y + 34;
        ncLines.forEach((line) => {
          const lines = doc.splitTextToSize(line, pageWidth - margin * 2 - 20);
          doc.text(lines, margin + 10, lineY);
          lineY += lines.length * 12;
        });
        y += blockHeight + 10;
      });
    }

    drawSectionTitle('Corrective Actions');
    if (!ncRecords.length) {
      ensureSpace(20);
      doc.text('No corrective actions recorded.', margin, y);
      y += 14;
    } else {
      ncRecords.forEach((record, idx) => {
        const lines = [
          `NC ${idx + 1} (Asset ${record.assetNumber ?? '—'}): ${record.question || '—'}`,
          `Root cause: ${record.rootCause || '—'}`,
          `Containment: ${record.containmentAction || '—'}`,
          `Corrective: ${record.correctiveAction || '—'}`,
          `Preventive: ${record.preventiveAction || '—'}`,
          `Evidence: ${record.evidenceName || '—'}`,
        ];
        const height = lines.length * 13 + 14;
        ensureSpace(height);
        doc.setFontSize(10.5);
        lines.forEach((line) => {
          const parts = doc.splitTextToSize(line, pageWidth - margin * 2);
          doc.text(parts, margin, y);
          y += parts.length * 12;
        });
        y += 6;
      });
    }

    drawSectionTitle('Question Responses');
    const sortedAnswers = [...answers].sort((a, b) => {
      const assetA = a.assetNumber ?? 1;
      const assetB = b.assetNumber ?? 1;
      if (assetA !== assetB) {
        return assetA - assetB;
      }
      return a.questionIndex - b.questionIndex;
    });
    sortedAnswers.forEach((answer) => {
      const assetLabel = answer.assetNumber ? `Asset ${answer.assetNumber} · ` : '';
      const questionTitle = `${assetLabel}Q${answer.questionIndex + 1}. ${answer.questionText || '—'}`;
      const blockHeight = 90;
      ensureSpace(blockHeight);
      doc.setDrawColor(235);
      doc.roundedRect(margin, y, pageWidth - margin * 2, blockHeight, 6, 6);
      doc.setFontSize(10);
      doc.setTextColor(90, 100, 120);
      doc.text(questionTitle, margin + 10, y + 18);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10.5);
      const detailLines = [
        `Response: ${answer.response || '—'}`,
        `Assigned NC: ${answer.assignedNc || '—'}`,
        `Status: ${answer.status || '—'}`,
        `Note: ${answer.note || '—'}`,
      ];
      let lineY = y + 34;
      detailLines.forEach((line) => {
        const lines = doc.splitTextToSize(line, pageWidth - margin * 2 - 20);
        doc.text(lines, margin + 10, lineY);
        lineY += lines.length * 12;
      });
      y += blockHeight + 10;
    });

    drawSectionTitle('Evidence Thumbnails');
    const thumbnails: { url: string; label: string }[] = [];
    sortedAnswers.forEach((answer) => {
      const url =
        answer.evidenceDataUrl || this.getEvidenceDataUrl(audit.code, answer.questionIndex);
      if (url) {
        thumbnails.push({
          url,
          label: `Q${answer.questionIndex + 1}`,
        });
      }
    });
    if (!thumbnails.length) {
      ensureSpace(20);
      doc.text('No evidence thumbnails available.', margin, y);
      y += 14;
    } else {
      const thumbWidth = 120;
      const thumbHeight = 80;
      const gap = 14;
      let x = margin;
      thumbnails.forEach((thumb, index) => {
        if (x + thumbWidth > pageWidth - margin) {
          x = margin;
          y += thumbHeight + 32;
        }
        ensureSpace(thumbHeight + 32);
        const format = thumb.url.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.setFontSize(9);
        doc.setTextColor(90, 100, 120);
        doc.text(thumb.label, x, y);
        doc.setTextColor(0, 0, 0);
        doc.addImage(thumb.url, format, x, y + 8, thumbWidth, thumbHeight);
        x += thumbWidth + gap;
        if ((index + 1) % 3 === 0) {
          x = margin;
          y += thumbHeight + 32;
        }
      });
      y += thumbHeight + 18;
    }

    drawSectionTitle('Approvals & Sign-off');
    ensureSpace(80);
    doc.setFontSize(10.5);
    doc.text(`Auditor: ${audit.auditorName || '—'}`, margin, y);
    y += 16;
    doc.text('Manager approval: ________________________________', margin, y);
    y += 16;
    doc.text('Date: ___________________', margin, y);

    doc.save(`audit-${audit.code}.pdf`);
  }

  private drawCharts(
    doc: jsPDF,
    x: number,
    y: number,
    width: number,
    answers: AuditAnswerRecord[],
    ncRecords: NcRecord[]
  ): number {
    const total = answers.length || 1;
    const negative = answers.filter((answer) => answer.responseIsNegative).length;
    const positive = total - negative;
    const statusCounts = ncRecords.reduce<Record<string, number>>((acc, record) => {
      const key = record.status || 'Unassigned';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    doc.setFontSize(12);
    doc.text('Response distribution', x, y);
    y += 14;

    const barHeight = 12;
    const maxBarWidth = width;
    const positiveWidth = (positive / total) * maxBarWidth;
    const negativeWidth = (negative / total) * maxBarWidth;

    doc.setFillColor(233, 245, 236);
    doc.rect(x, y, positiveWidth, barHeight, 'F');
    doc.setFillColor(255, 226, 200);
    doc.rect(x + positiveWidth, y, negativeWidth, barHeight, 'F');
    doc.setTextColor(80, 80, 80);
    doc.text(`Positive: ${positive}`, x + maxBarWidth + 10, y + 10);
    y += barHeight + 18;

    doc.setFontSize(12);
    doc.text('NC status', x, y);
    y += 14;
    doc.setFontSize(10);
    Object.entries(statusCounts).forEach(([status, count]) => {
      doc.text(`${status}: ${count}`, x, y);
      y += 12;
    });

    doc.setTextColor(0, 0, 0);
    return y;
  }

  private ensureSpace(doc: jsPDF, y: number, pageHeight: number, needed: number): number {
    if (y + needed <= pageHeight - 40) {
      return y;
    }
    doc.addPage();
    return 40;
  }

  private getEvidenceDataUrl(auditCode: string, index: number): string {
    const key = `audir_evidence_${auditCode}_${index}`;
    return localStorage.getItem(key) ?? '';
  }
}
