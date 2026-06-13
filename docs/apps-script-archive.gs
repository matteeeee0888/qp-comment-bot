/**
 * QuietProtector → Google Sheet archive web app (COMPLETE — paste this over the whole script).
 *
 * Routes incoming rows to a tab by the payload's "tab" field:
 *   - "Comments" (or missing)  → your existing comments tab (the first/leftmost sheet) — UNCHANGED.
 *   - "News"                   → a managed "News" tab (created with headers on first write).
 * Accepts a single flat row {tab, token, ...fields} OR a batch {tab, token, rows:[{...}, ...]}.
 *
 * Redeploy WITHOUT changing the URL:
 *   Deploy ▸ Manage deployments ▸ (your web app) ▸ ✏️ Edit ▸ Version: "New version" ▸ Deploy.
 *   (Editing the existing deployment keeps the same /exec URL, so the GitHub secret stays valid.)
 *   Execute as: Me  ·  Who has access: Anyone.
 */
var SHEET_ID = '1ScKfDV78ula5zeG7rxFOTZzOPCGH3WxnHi7-YcYbnMQ';
var SECRET   = 'qp-arch-7Kp2xQ9';

var NEWS_HEADERS = ['captured_at','brand','headline','source','url','score','t','e','b','u','m','angle','why_now','status'];

function doGet(e) {
  return ContentService.createTextOutput('archive ready').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.token !== SECRET) {
      return ContentService.createTextOutput('forbidden').setMimeType(ContentService.MimeType.TEXT);
    }
    var ss = SpreadsheetApp.openById(SHEET_ID);

    // ---- News tab (batch of shortlisted stories) ----
    if (data.tab === 'News') {
      var ns = ss.getSheetByName('News') || ss.insertSheet('News');
      if (ns.getLastRow() === 0) { ns.appendRow(NEWS_HEADERS); ns.setFrozenRows(1); }
      var rows = Array.isArray(data.rows) ? data.rows : [data];
      rows.forEach(function (row) {
        ns.appendRow(NEWS_HEADERS.map(function (h) { return row[h] != null ? row[h] : ''; }));
      });
      return ContentService.createTextOutput('ok ' + rows.length).setMimeType(ContentService.MimeType.TEXT);
    }

    // ---- Comments (default) — append to the existing first tab, exactly as before ----
    var cs = ss.getSheetByName('Comments') || ss.getSheets()[0];
    cs.appendRow([
      data.captured_at || '', data.page_name || '', data.page_id || '', data.source || '',
      data.comment_id || '', data.author || '', data.author_id || '', data.message || '',
      data.created_time || '', data.product || '', data.category || '', data.action || '', data.reply || ''
    ]);
    return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err).setMimeType(ContentService.MimeType.TEXT);
  }
}
