export interface BrandedPdfSummaryMetric {
  label: string;
  value: string | number;
}

export interface BrandedPdfColumn {
  header: string;
  align?: 'left' | 'right' | 'center';
}

export interface BrandedAttendancePdfPayload {
  reportTitle: string;
  subtitle?: string;
  reportPeriod?: string;
  dateRangeLabel?: string;
  branchName?: string;
  clientName?: string;
  siteName?: string;
  branchOrSiteLabel?: string;
  generatedBy?: string;
  summaryMetrics: BrandedPdfSummaryMetric[];
  columns?: BrandedPdfColumn[];
  headers?: string[];
  rows: Array<Array<string | number>>;
  footerNote?: string;
  fileNamePrefix?: string;
  filenameSlug?: string;
}

function escapeHtml(raw: string | number | null | undefined): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatIstTimestampForReport(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function buildBrandedAttendanceReportHtml(payload: BrandedAttendancePdfPayload): string {
  const generatedIst = formatIstTimestampForReport(new Date());
  const resolvedColumns: BrandedPdfColumn[] =
    payload.columns && payload.columns.length > 0
      ? payload.columns
      : (payload.headers || []).map((h) => ({ header: h, align: 'left' }));

  const metaItems = [
    { label: 'Report Period', value: payload.reportPeriod || payload.dateRangeLabel || 'All Dates' },
    { label: 'Branch', value: payload.branchName || payload.branchOrSiteLabel || 'All Authorized Branches' },
    { label: 'Client Organization', value: payload.clientName || 'All Authorized Clients' },
    { label: 'Deployment Site', value: payload.siteName || payload.branchOrSiteLabel || 'All Authorized Sites' },
    { label: 'Generated Date (IST)', value: `${generatedIst} IST` },
    { label: 'Prepared By', value: payload.generatedBy || 'REXON Operations Portal' },
  ];

  const metricsHtml = payload.summaryMetrics
    .map(
      (m) => `
      <div class="kpi-box">
        <div class="kpi-label">${escapeHtml(m.label)}</div>
        <div class="kpi-val">${escapeHtml(m.value)}</div>
      </div>`
    )
    .join('');

  const headersHtml = resolvedColumns
    .map(
      (c) =>
        `<th style="text-align:${c.align || 'left'}">${escapeHtml(c.header)}</th>`
    )
    .join('');

  const rowsHtml =
    payload.rows.length === 0
      ? `<tr><td colspan="${Math.max(1, resolvedColumns.length)}" style="text-align:center;padding:20px;color:#6F5E53;">No attendance records match the selected report parameters.</td></tr>`
      : payload.rows
          .map(
            (r) =>
              `<tr>${r
                .map((cell, idx) => {
                  const align = resolvedColumns[idx]?.align || 'left';
                  return `<td style="text-align:${align}">${escapeHtml(cell)}</td>`;
                })
                .join('')}</tr>`
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(payload.reportTitle)} — REXON Security &amp; Manpower Solutions</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif;
      color: #211813;
      background: #FFFFFF;
      font-size: 11px;
      line-height: 1.45;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #5C3D2E;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .company-brand {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 0.02em;
      color: #5C3D2E;
      margin: 0;
    }
    .company-sub {
      font-size: 11px;
      color: #6F5E53;
      margin: 3px 0 0 0;
    }
    .report-title-box {
      text-align: right;
    }
    .report-title {
      font-size: 15px;
      font-weight: 700;
      color: #211813;
      margin: 0;
    }
    .report-code {
      font-size: 10px;
      color: #6F5E53;
      margin-top: 3px;
      font-variant-numeric: tabular-nums;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px 16px;
      background: #FAF8F5;
      border: 1px solid #E6DFD5;
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 14px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      font-size: 9.5px;
      color: #6F5E53;
      font-weight: 600;
    }
    .meta-value {
      font-size: 11px;
      font-weight: 700;
      color: #211813;
      font-variant-numeric: tabular-nums;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 8px;
      margin-bottom: 14px;
    }
    .kpi-box {
      border: 1px solid #E6DFD5;
      border-radius: 6px;
      padding: 8px 10px;
      background: #FFFFFF;
    }
    .kpi-label {
      font-size: 9.5px;
      color: #6F5E53;
    }
    .kpi-val {
      font-size: 14px;
      font-weight: 700;
      color: #211813;
      margin-top: 2px;
      font-variant-numeric: tabular-nums;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
      font-variant-numeric: tabular-nums;
    }
    th {
      background: #F3EDE4;
      color: #211813;
      font-weight: 700;
      font-size: 10px;
      padding: 7px 8px;
      border: 1px solid #D4C7B8;
    }
    td {
      padding: 6px 8px;
      border: 1px solid #E6DFD5;
      font-size: 10px;
      color: #211813;
      vertical-align: top;
    }
    tr:nth-child(even) td {
      background: #FCFBF9;
    }
    .footer-note {
      font-size: 9.5px;
      color: #6F5E53;
      margin-bottom: 24px;
    }
    .sig-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 32px;
      margin-top: 28px;
      page-break-inside: avoid;
    }
    .sig-block {
      border-top: 1px solid #8D7B6E;
      padding-top: 6px;
      font-size: 10px;
      font-weight: 600;
      color: #211813;
      text-align: center;
    }
    .sig-sub {
      font-size: 9px;
      font-weight: 400;
      color: #6F5E53;
      margin-top: 2px;
    }
    .no-print-toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 12px;
    }
    .print-btn {
      background: #5C3D2E;
      color: #FFFFFF;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    @media print {
      body { padding: 0; }
      .no-print-toolbar { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print-toolbar">
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  </div>

  <div class="header-bar">
    <div>
      <h1 class="company-brand">REXON SECURITY &amp; MANPOWER SOLUTIONS</h1>
      <p class="company-sub">Workforce Attendance, Duty Roster &amp; Site Compliance Division</p>
    </div>
    <div class="report-title-box">
      <h2 class="report-title">${escapeHtml(payload.reportTitle)}</h2>
      <div class="report-code">${escapeHtml(payload.subtitle || 'Official Operational Statement · Asia/Kolkata (IST)')}</div>
    </div>
  </div>

  <div class="meta-grid">
    ${metaItems
      .map(
        (item) => `
      <div class="meta-item">
        <span class="meta-label">${escapeHtml(item.label)}</span>
        <span class="meta-value">${escapeHtml(item.value)}</span>
      </div>`
      )
      .join('')}
  </div>

  <div class="kpi-grid">
    ${metricsHtml}
  </div>

  <table>
    <thead>
      <tr>${headersHtml}</tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer-note">
    ${escapeHtml(
      payload.footerNote ||
        'Compliance Note: Only HR-Verified or Exception-Approved attendance records are eligible for downstream Payroll computation. Unverified or rejected records remain excluded.'
    )}
  </div>

  <div class="sig-grid">
    <div class="sig-block">
      Prepared By
      <div class="sig-sub">HR / Attendance Operations</div>
    </div>
    <div class="sig-block">
      Verified &amp;Checked By
      <div class="sig-sub">Branch Manager / Senior HR</div>
    </div>
    <div class="sig-block">
      Authorized Signatory
      <div class="sig-sub">REXON Security &amp; Manpower Solutions</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Triggers native browser Print / Save-as-PDF via a hidden same-origin iframe
 * (strictly avoids `window.open` for iframe sandbox compatibility), and also
 * downloads a self-contained printable HTML statement if requested or if print is blocked.
 */
export function exportBrandedAttendancePdf(
  payload: BrandedAttendancePdfPayload,
  mode: 'print' | 'download' = 'print'
): void {
  const html = buildBrandedAttendanceReportHtml(payload);
  const safePrefix = (
    payload.fileNamePrefix ||
    payload.filenameSlug ||
    payload.reportTitle ||
    'REXON_Attendance_Report'
  )
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 60);
  const datePart = new Date().toISOString().slice(0, 10);

  if (mode === 'download') {
    const blob = new Blob(['\uFEFF' + html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safePrefix}_${datePart}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return;
  }

  try {
    const existingFrame = document.getElementById('rexon-pdf-print-frame') as HTMLIFrameElement | null;
    if (existingFrame) {
      existingFrame.remove();
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'rexon-pdf-print-frame';
    iframe.title = 'REXON Attendance PDF Print Frame';
    iframe.className = 'fixed right-0 bottom-0 w-0 h-0 border-0 opacity-0 pointer-events-none';
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow?.document;
    if (!frameDoc || !iframe.contentWindow) {
      exportBrandedAttendancePdf(payload, 'download');
      return;
    }

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        exportBrandedAttendancePdf(payload, 'download');
      }
    }, 250);
  } catch {
    exportBrandedAttendancePdf(payload, 'download');
  }
}
