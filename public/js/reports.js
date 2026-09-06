// public/js/reports.js
// Premium "Reports" feature. Daily/Monthly/Yearly/All views are all
// aggregated client-side from GET /expanse (already loaded in full into
// `allExpenses`). The Daily tab has a date picker, the Monthly tab has
// month + year selects, and the Yearly tab has a year select - each one
// scopes both the on-screen table AND the "Download" button, which asks
// the backend for a CSV of just that date/month/year (see
// controllers/report.js). The backend builds it, uploads it to S3, and
// returns a time-limited presigned URL - the file itself never touches
// this server's disk. Past downloads are listed below via
// GET /report/history (see routes/report.js).
const premiumBadge = document.getElementById("premiumBadge");
const lockedCard = document.getElementById("lockedCard");
const reportContent = document.getElementById("reportContent");
const reportEmpty = document.getElementById("reportEmpty");
const reportTables = document.getElementById("reportTables");
const downloadBtn = document.getElementById("downloadBtn");
const downloadBtnLabel = document.getElementById("downloadBtnLabel");
const viewTabs = document.getElementById("viewTabs");
const totalIncomeEl = document.getElementById("totalIncome");
const totalExpenseEl = document.getElementById("totalExpense");
const totalSavingsEl = document.getElementById("totalSavings");
const allExpensesPagination = document.getElementById("allExpensesPagination");
const allPrevPageBtn = document.getElementById("allPrevPageBtn");
const allNextPageBtn = document.getElementById("allNextPageBtn");
const allPageInfo = document.getElementById("allPageInfo");
const allPageSizeSelect = document.getElementById("allPageSizeSelect");
const downloadResult = document.getElementById("downloadResult");
const reportHistoryEmpty = document.getElementById("reportHistoryEmpty");
const reportHistoryTable = document.getElementById("reportHistoryTable");
const reportHistoryBody = document.getElementById("reportHistoryBody");

// Per-tab filter controls
const dailyFilter = document.getElementById("dailyFilter");
const dailyDatePicker = document.getElementById("dailyDatePicker");
const monthlyFilter = document.getElementById("monthlyFilter");
const monthSelect = document.getElementById("monthSelect");
const yearSelectMonthly = document.getElementById("yearSelectMonthly");
const yearlyFilter = document.getElementById("yearlyFilter");
const yearSelectYearly = document.getElementById("yearSelectYearly");

let allExpenses = [];
let currentView = "daily";
let isPremiumUser = false;

// "All Expenses" tab pagination - independent of the Daily/Monthly/Yearly
// views above, which need the FULL unpaginated `allExpenses` array to
// compute correct totals/subtotals. Page size is user-configurable and
// shared with the dashboard's preference via the same localStorage key.
const PAGE_SIZE_STORAGE_KEY = "expanseTracker:pageSize";
const PAGE_SIZE_OPTIONS = [5, 8, 10, 15, 20, 25, 30, 40];
const DEFAULT_PAGE_SIZE = 10;
let allViewPageSize = getStoredPageSize();
let allViewPage = 1;
let allViewTotalPages = 1;

function getStoredPageSize() {
  try {
    const stored = parseInt(localStorage.getItem(PAGE_SIZE_STORAGE_KEY), 10);
    return PAGE_SIZE_OPTIONS.includes(stored) ? stored : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}
function setStoredPageSize(size) {
  try {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
  } catch {
    // localStorage unavailable - preference just won't persist this session.
  }
}
function initPageSizeSelect() {
  allPageSizeSelect.innerHTML = PAGE_SIZE_OPTIONS.map((n) => `<option value="${n}">${n}</option>`).join("");
  allPageSizeSelect.value = String(allViewPageSize);
}
allPageSizeSelect.addEventListener("change", () => {
  allViewPageSize = parseInt(allPageSizeSelect.value, 10) || DEFAULT_PAGE_SIZE;
  setStoredPageSize(allViewPageSize);
  loadAllExpensesPage(1);
});

// Categories that represent money coming in. The Expanse model doesn't
// have an explicit income/expense flag yet, so - matching how "Salary"
// is already used as a category in this app - anything filed under
// Salary is treated as income and everything else as an expense.
const INCOME_CATEGORIES = new Set(["Salary"]);

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function checkAuthAndLoad() {
  try {
    const res = await fetch("/user/session");
    const data = await res.json();
    if (!data.loggedIn) {
      window.location.href = "/login.html";
      return;
    }
    isPremiumUser = !!data.user.isPremium;
    premiumBadge.style.display = isPremiumUser ? "inline-block" : "none";
    if (!isPremiumUser) {
      lockedCard.style.display = "block";
      reportContent.style.display = "none";
      setDownloadEnabled(false);
      return;
    }
    lockedCard.style.display = "none";
    reportContent.style.display = "block";
    setDownloadEnabled(true);
    initPageSizeSelect();
    await loadExpenses();
    initFilterControls();
    renderCurrentView();
    await loadReportHistory();
  } catch {
    window.location.href = "/login.html";
  }
}
async function loadExpenses() {
  const res = await fetch("/expanse");
  if (!res.ok) throw new Error("Failed to load expenses.");
  allExpenses = await res.json();
}
function setDownloadEnabled(enabled) {
  downloadBtn.disabled = !enabled;
  downloadBtn.title = enabled ? "Download report" : "Upgrade to Premium to download reports";
}

// --- Filter controls (date picker / month & year selects / year select) ---
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yearsFromExpenses() {
  const years = new Set([new Date().getFullYear()]);
  allExpenses.forEach((exp) => years.add(new Date(exp.createdAt).getFullYear()));
  return [...years].sort((a, b) => b - a);
}
function initFilterControls() {
  const now = new Date();
  const years = yearsFromExpenses();

  dailyDatePicker.value = todayStr();
  dailyDatePicker.max = todayStr();

  monthSelect.innerHTML = MONTH_NAMES.map((name, i) => `<option value="${i + 1}">${name}</option>`).join("");
  monthSelect.value = String(now.getMonth() + 1);
  yearSelectMonthly.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  yearSelectMonthly.value = String(now.getFullYear());

  yearSelectYearly.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  yearSelectYearly.value = String(now.getFullYear());

  dailyDatePicker.addEventListener("change", () => {
    if (currentView === "daily") renderCurrentView();
  });
  monthSelect.addEventListener("change", () => {
    if (currentView === "monthly") renderCurrentView();
  });
  yearSelectMonthly.addEventListener("change", () => {
    if (currentView === "monthly") renderCurrentView();
  });
  yearSelectYearly.addEventListener("change", () => {
    if (currentView === "yearly") renderCurrentView();
  });
}
function updateFilterVisibility() {
  dailyFilter.style.display = currentView === "daily" ? "flex" : "none";
  monthlyFilter.style.display = currentView === "monthly" ? "flex" : "none";
  yearlyFilter.style.display = currentView === "yearly" ? "flex" : "none";
  const labels = { daily: "Download Day", monthly: "Download Month", yearly: "Download Year", all: "Download All" };
  downloadBtnLabel.textContent = labels[currentView] || "Download";
}

// --- Tabs ---
viewTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  viewTabs.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentView = btn.dataset.view;
  renderCurrentView();
});
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function money(n) {
  return `₹${Number(n || 0).toFixed(2)}`;
}
function isIncome(exp) {
  return INCOME_CATEGORIES.has(exp.category);
}
function dayKey(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}
function formatDate(dKey) {
  const [y, m, d] = dKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function renderCurrentView() {
  reportTables.innerHTML = "";
  computeOverallTotals();
  allExpensesPagination.style.display = "none";
  updateFilterVisibility();
  if (allExpenses.length === 0) {
    reportEmpty.style.display = "block";
    return;
  }
  reportEmpty.style.display = "none";
  if (currentView === "daily") renderDaily();
  else if (currentView === "monthly") renderMonthlyView();
  else if (currentView === "yearly") renderYearlyView();
  else loadAllExpensesPage(1);
}
// --- "All Expenses" tab: flat, paginated list (10 per page) ---
async function loadAllExpensesPage(page) {
  try {
    const res = await fetch(`/expanse?page=${page}&limit=${allViewPageSize}`);
    if (!res.ok) throw new Error("Failed to load expenses.");
    const data = await res.json();
    allViewPage = data.currentPage;
    allViewTotalPages = data.totalPages;
    renderAllExpensesTable(data.expenses);
    renderAllExpensesPagination(data.totalCount);
  } catch (err) {
    reportEmpty.textContent = err.message;
    reportEmpty.style.display = "block";
  }
}
function renderAllExpensesTable(expenses) {
  let rowsHtml = "";
  expenses.forEach((exp) => {
    const income = isIncome(exp);
    rowsHtml += `
      <tr>
        <td>${new Date(exp.createdAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</td>
        <td>${escapeHtml(exp.description)}</td>
        <td>${escapeHtml(exp.category)}</td>
        <td class="amount-cell">${income ? money(exp.amount) : ""}</td>
        <td class="amount-cell expense-amount">${income ? "" : money(exp.amount)}</td>
      </tr>`;
  });
  reportTables.innerHTML = `
    <table class="report-table">
      <thead>
        <tr><th>Date</th><th>Description</th><th>Category</th><th>Income</th><th>Expense</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}
function renderAllExpensesPagination(totalCount) {
  allExpensesPagination.style.display = "flex";
  allPageInfo.textContent = `Page ${allViewPage} of ${allViewTotalPages} (${totalCount} total)`;
  allPrevPageBtn.disabled = allViewPage <= 1;
  allNextPageBtn.disabled = allViewPage >= allViewTotalPages;
}
allPrevPageBtn.addEventListener("click", () => {
  if (allViewPage > 1) loadAllExpensesPage(allViewPage - 1);
});
allNextPageBtn.addEventListener("click", () => {
  if (allViewPage < allViewTotalPages) loadAllExpensesPage(allViewPage + 1);
});
function computeOverallTotals() {
  let income = 0;
  let expense = 0;
  allExpenses.forEach((exp) => {
    if (isIncome(exp)) income += Number(exp.amount);
    else expense += Number(exp.amount);
  });
  totalIncomeEl.textContent = money(income);
  totalExpenseEl.textContent = money(expense);
  totalSavingsEl.textContent = money(income - expense);
}
// --- Daily view: filtered to the date picked in dailyDatePicker ---
function renderDaily() {
  const dateStr = dailyDatePicker.value || todayStr();
  const dayExpenses = allExpenses.filter((exp) => dayKey(new Date(exp.createdAt)) === dateStr);
  if (dayExpenses.length === 0) {
    reportTables.innerHTML = `<div class="empty-state">No expenses recorded on ${formatDate(dateStr)}.</div>`;
    return;
  }
  let dayIncome = 0;
  let dayExpense = 0;
  let rowsHtml = "";
  dayExpenses.forEach((exp) => {
    const income = isIncome(exp);
    if (income) dayIncome += Number(exp.amount);
    else dayExpense += Number(exp.amount);
    rowsHtml += `
      <tr>
        <td>${escapeHtml(exp.description)}</td>
        <td>${escapeHtml(exp.category)}</td>
        <td class="amount-cell">${income ? money(exp.amount) : ""}</td>
        <td class="amount-cell expense-amount">${income ? "" : money(exp.amount)}</td>
      </tr>`;
  });
  reportTables.innerHTML = `
    <h3 class="report-section-title">${formatDate(dateStr)}</h3>
    <table class="report-table">
      <thead>
        <tr><th>Description</th><th>Category</th><th>Income</th><th>Expense</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr class="report-total-row">
          <td colspan="2">Day total</td>
          <td class="amount-cell">${money(dayIncome)}</td>
          <td class="amount-cell expense-amount">${money(dayExpense)}</td>
        </tr>
        <tr class="report-savings-row"><td colspan="4">Savings = ${money(dayIncome - dayExpense)}</td></tr>
      </tfoot>
    </table>`;
}
// --- Monthly view: filtered to the month + year selected above ---
function renderMonthlyView() {
  const month = parseInt(monthSelect.value, 10);
  const year = parseInt(yearSelectMonthly.value, 10);
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const byDay = new Map();
  allExpenses.forEach((exp) => {
    const d = new Date(exp.createdAt);
    if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return;
    const dKey = dayKey(d);
    if (!byDay.has(dKey)) byDay.set(dKey, []);
    byDay.get(dKey).push(exp);
  });
  if (byDay.size === 0) {
    reportTables.innerHTML = `<div class="empty-state">No expenses recorded in ${monthLabel(key)}.</div>`;
    return;
  }
  const dayKeys = [...byDay.keys()].sort().reverse();
  let monthIncome = 0;
  let monthExpense = 0;
  let rowsHtml = "";
  dayKeys.forEach((dKey) => {
    const rows = byDay.get(dKey);
    let dayIncome = 0;
    let dayExpense = 0;
    rows.forEach((exp, i) => {
      const income = isIncome(exp);
      if (income) dayIncome += Number(exp.amount);
      else dayExpense += Number(exp.amount);
      rowsHtml += `
        <tr>
          <td>${i === 0 ? formatDate(dKey) : ""}</td>
          <td>${escapeHtml(exp.description)}</td>
          <td>${escapeHtml(exp.category)}</td>
          <td class="amount-cell">${income ? money(exp.amount) : ""}</td>
          <td class="amount-cell expense-amount">${income ? "" : money(exp.amount)}</td>
        </tr>`;
    });
    rowsHtml += `
      <tr class="report-subtotal-row">
        <td colspan="3">Day total</td>
        <td class="amount-cell">${money(dayIncome)}</td>
        <td class="amount-cell expense-amount">${money(dayExpense)}</td>
      </tr>`;
    monthIncome += dayIncome;
    monthExpense += dayExpense;
  });
  reportTables.innerHTML = `
    <h3 class="report-section-title">${monthLabel(key)}</h3>
    <table class="report-table">
      <thead>
        <tr><th>Date</th><th>Description</th><th>Category</th><th>Income</th><th>Expense</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr class="report-total-row">
          <td colspan="3">Month total</td>
          <td class="amount-cell">${money(monthIncome)}</td>
          <td class="amount-cell expense-amount">${money(monthExpense)}</td>
        </tr>
        <tr class="report-savings-row"><td colspan="5">Savings = ${money(monthIncome - monthExpense)}</td></tr>
      </tfoot>
    </table>`;
}
// --- Yearly view: filtered to the year selected above, one row per month ---
function renderYearlyView() {
  const year = parseInt(yearSelectYearly.value, 10);
  const byMonth = new Map();
  allExpenses.forEach((exp) => {
    const d = new Date(exp.createdAt);
    if (d.getFullYear() !== year) return;
    const key = monthKey(d);
    if (!byMonth.has(key)) byMonth.set(key, { income: 0, expense: 0 });
    const bucket = byMonth.get(key);
    if (isIncome(exp)) bucket.income += Number(exp.amount);
    else bucket.expense += Number(exp.amount);
  });
  if (byMonth.size === 0) {
    reportTables.innerHTML = `<div class="empty-state">No expenses recorded in ${year}.</div>`;
    return;
  }
  const monthKeys = [...byMonth.keys()].sort().reverse();
  let yearIncome = 0;
  let yearExpense = 0;
  let rowsHtml = "";
  monthKeys.forEach((key) => {
    const bucket = byMonth.get(key);
    yearIncome += bucket.income;
    yearExpense += bucket.expense;
    rowsHtml += `
      <tr>
        <td>${monthLabel(key)}</td>
        <td class="amount-cell">${money(bucket.income)}</td>
        <td class="amount-cell expense-amount">${money(bucket.expense)}</td>
        <td class="amount-cell">${money(bucket.income - bucket.expense)}</td>
      </tr>`;
  });
  reportTables.innerHTML = `
    <h3 class="report-section-title">${year} Report</h3>
    <table class="report-table">
      <thead>
        <tr><th>Month</th><th>Income</th><th>Expense</th><th>Savings</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr class="report-total-row">
          <td>Year total</td>
          <td class="amount-cell">${money(yearIncome)}</td>
          <td class="amount-cell expense-amount">${money(yearExpense)}</td>
          <td class="amount-cell">${money(yearIncome - yearExpense)}</td>
        </tr>
      </tfoot>
    </table>`;
}
// --- Download: backend generates the CSV (scoped to whichever
// date/month/year the active tab has selected), uploads it to S3, and
// returns a presigned URL. We show that URL (and open it) rather than
// building the file in the browser. ---
function downloadQueryString() {
  if (currentView === "daily") {
    return `?type=date&date=${encodeURIComponent(dailyDatePicker.value || todayStr())}`;
  }
  if (currentView === "monthly") {
    return `?type=month&month=${encodeURIComponent(monthSelect.value)}&year=${encodeURIComponent(yearSelectMonthly.value)}`;
  }
  if (currentView === "yearly") {
    return `?type=year&year=${encodeURIComponent(yearSelectYearly.value)}`;
  }
  return ""; // "all" tab - no filter, matches the original full-history download.
}
downloadBtn.addEventListener("click", async () => {
  if (downloadBtn.disabled || !isPremiumUser) return;
  downloadBtn.disabled = true;
  const originalLabel = downloadBtnLabel.textContent;
  downloadBtnLabel.textContent = "Generating...";
  downloadResult.style.display = "none";
  try {
    const res = await fetch(`/report/generate${downloadQueryString()}`);
    if (res.status === 401) {
      downloadResult.textContent = "This feature is available to Premium members only.";
      downloadResult.style.display = "block";
      return;
    }
    if (!res.ok) throw new Error("Failed to generate report.");
    const { fileUrl, fileName } = await res.json();
    downloadResult.innerHTML = `Report ready: <a href="${fileUrl}" target="_blank" rel="noopener">${fileName}</a>`;
    downloadResult.style.display = "block";
    window.open(fileUrl, "_blank", "noopener");
    await loadReportHistory();
  } catch {
    downloadResult.textContent = "Something went wrong generating your report. Please try again.";
    downloadResult.style.display = "block";
  } finally {
    downloadBtn.disabled = false;
    downloadBtnLabel.textContent = originalLabel;
  }
});
// --- Past downloads list (bonus task) ---
async function loadReportHistory() {
  try {
    const res = await fetch("/report/history");
    if (!res.ok) throw new Error("Failed to load report history.");
    const history = await res.json();
    if (!history.length) {
      reportHistoryTable.style.display = "none";
      reportHistoryEmpty.style.display = "block";
      return;
    }
    reportHistoryEmpty.style.display = "none";
    reportHistoryTable.style.display = "table";
    reportHistoryBody.innerHTML = history
      .map(
        (r) => `
      <tr>
        <td>${r.fileName}</td>
        <td>${new Date(r.generatedAt).toLocaleString()}</td>
        <td><a href="${r.fileUrl}" target="_blank" rel="noopener">Download</a></td>
      </tr>`,
      )
      .join("");
  } catch {
    reportHistoryEmpty.textContent = "Couldn't load past reports.";
    reportHistoryEmpty.style.display = "block";
    reportHistoryTable.style.display = "none";
  }
}
checkAuthAndLoad();
// Re-check premium status when the page is restored from bfcache, same
// pattern used on the dashboard.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) checkAuthAndLoad();
});
