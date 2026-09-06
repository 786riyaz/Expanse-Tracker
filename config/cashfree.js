import logger from "../utils/logger.js";
import { Cashfree, CFEnvironment } from "cashfree-pg";

const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
  logger.warn("Warning: CASHFREE_APP_ID / CASHFREE_SECRET_KEY are not set. " + "Add them to a .env file before trying any payment flow.");
}
const cashfree = new Cashfree(CFEnvironment.SANDBOX, CASHFREE_APP_ID, CASHFREE_SECRET_KEY);
export default cashfree;
