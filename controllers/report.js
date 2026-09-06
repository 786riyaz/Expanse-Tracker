import logger from "../utils/logger.js";
import { Op } from "sequelize";
import { Expanse, Report, User } from "../models/index.js";
import { uploadReportToS3, getReportDownloadUrl } from "../services/s3Service.js";

function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(expanses) {
  const rows = [["Date", "Category", "Description", "Note", "Amount"]];
  expanses.forEach((e) => {
    rows.push([new Date(e.createdAt).toISOString().slice(0, 10), e.category, e.description, e.note ?? "", e.amount]);
  });
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

// Builds a `createdAt` Sequelize where-clause from the report type the
// client asked for. Returns null (no filter -> all expenses) when the
// type/params are missing or invalid, so /report/generate keeps working
// with no query params at all (the "All Expenses" tab download).
function buildDateRange(type, date, month, year) {
  if (type === "date" && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const start = new Date(`${date}T00:00:00`);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { [Op.gte]: start, [Op.lt]: end };
  }
  if (type === "month" && month && year) {
    const m = Number(month);
    const y = Number(year);
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y)) return null;
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    return { [Op.gte]: start, [Op.lt]: end };
  }
  if (type === "year" && year) {
    const y = Number(year);
    if (!Number.isInteger(y)) return null;
    const start = new Date(y, 0, 1);
    const end = new Date(y + 1, 0, 1);
    return { [Op.gte]: start, [Op.lt]: end };
  }
  return null;
}

// Matching, human-readable file name for whichever filter was applied.
function buildFileName(type, date, month, year) {
  const stamp = Date.now();
  if (type === "date" && date) return `expenses-${date}-${stamp}.csv`;
  if (type === "month" && month && year) return `expenses-${year}-${String(month).padStart(2, "0")}-${stamp}.csv`;
  if (type === "year" && year) return `expenses-${year}-${stamp}.csv`;
  return `expenses-all-${new Date().toISOString().slice(0, 10)}-${stamp}.csv`;
}

const reportController = {
  // GET /report/generate - premium only. Deliverable explicitly calls for
  // 401 (not the 403 the shared isPremiumUser middleware uses elsewhere),
  // so this checks isPremium itself instead of reusing that middleware.
  //
  // Optional query params scope the CSV to a single date/month/year:
  //   ?type=date&date=YYYY-MM-DD
  //   ?type=month&month=1-12&year=YYYY
  //   ?type=year&year=YYYY
  // With no (or invalid) params, it falls back to every expense - same
  // as the original "download everything" behaviour.
  generateReport: async (req, res) => {
    try {
      const user = await User.findByPk(req.userId, { attributes: ["id", "isPremium"] });
      if (!user || !user.isPremium) {
        return res.status(401).json({ error: "This feature is available to Premium members only." });
      }
      const { type, date, month, year } = req.query;
      const where = { userId: req.userId };
      const range = buildDateRange(type, date, month, year);
      if (range) where.createdAt = range;
      const expanses = await Expanse.findAll({
        where,
        attributes: ["category", "description", "amount", "note", "createdAt"],
        order: [["createdAt", "ASC"]],
      });
      const csv = toCsv(expanses);
      const fileName = buildFileName(type, date, month, year);
      const s3Key = `reports/${req.userId}/${fileName}`;
      await uploadReportToS3(s3Key, csv);
      const report = await Report.create({ userId: req.userId, s3Key, fileName });
      const fileUrl = await getReportDownloadUrl(s3Key);
      res.status(201).json({ fileName, fileUrl, generatedAt: report.createdAt });
    } catch (error) {
      logger.error("Generate report error:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to generate report." });
    }
  },
  // GET /report/history - past reports this user has generated, newest
  // first, each with a freshly-signed download URL.
  getHistory: async (req, res) => {
    try {
      const user = await User.findByPk(req.userId, { attributes: ["id", "isPremium"] });
      if (!user || !user.isPremium) {
        return res.status(401).json({ error: "This feature is available to Premium members only." });
      }
      const reports = await Report.findAll({
        where: { userId: req.userId },
        attributes: ["fileName", "s3Key", "createdAt"],
        order: [["createdAt", "DESC"]],
      });
      const history = await Promise.all(
        reports.map(async (r) => ({
          fileName: r.fileName,
          generatedAt: r.createdAt,
          fileUrl: await getReportDownloadUrl(r.s3Key),
        })),
      );
      res.status(200).json(history);
    } catch (error) {
      logger.error("Report history error:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to fetch report history." });
    }
  },
};
export default reportController;
